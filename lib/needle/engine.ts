import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ------------------------- Cactus Needle 3 wasm engine -------------------------
//
// Vendored from Cactus-Compute/needle3 (wasm/needle.js + wasm/needle.wasm,
// apache-2.0). The engine is a ~686 KB WebAssembly module that maps
// `needle3.cact` (the 35 MB, 20-layer Needle 3 archive) into memory and runs
// inference in-process. No network, no API key, no native toolchain.
//
// The C API surface (see ./needle.h) is five functions. Two things about it
// shape this wrapper:
//
//   1. The model is process-global and explicitly non-thread-safe, so every
//      call into it is serialised through a promise queue.
//   2. The engine keeps conversation state across `complete()` calls. For
//      independent one-shot requests we reset first, otherwise a later query
//      gets resolved against an earlier turn's context.

const ENGINE_DIR = path.join(process.cwd(), "lib", "needle");
const MODEL_PATH = path.join(process.cwd(), "needle3.cact");

const OUT_CAPACITY = 64 * 1024;

type NeedleWasm = {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _needle_load(cactPtr: number, byteLength: bigint): number;
  _needle_init(
    systemPromptPtr: number,
    toolsJsonPtr: number,
    toolIndexPathPtr: number,
  ): number;
  _needle_complete(
    inputPtr: number,
    maxNewTokens: number,
    outPtr: number,
    outCapacity: number,
  ): number;
  _needle_embed(inputPtr: number, outPtr: number, outCapacity: number): number;
  _needle_reset(): void;
  UTF8ToString(ptr: number): string;
  HEAPU8: Uint8Array;
};

type CreateNeedle = (options?: {
  locateFile?: (file: string) => string;
}) => Promise<NeedleWasm>;

export type NeedleCompletion = {
  type: string;
  success: boolean;
  error: string | null;
  function_calls: Array<{ name: string; arguments: Record<string, unknown> }>;
  reasoning: string | null;
  confidence: number | null;
  decode_tps: number;
  prefill_tps: number;
};

export type NeedleStatus = {
  modelBytes: number;
  modelSha256: string;
  engine: "wasm";
  loaded: boolean;
};

let glueFactory: CreateNeedle | null = null;

function loadGlue(): CreateNeedle {
  if (glueFactory) return glueFactory;

  // `__non_webpack_require__` keeps the emscripten glue out of the server
  // bundle: it locates needle.wasm relative to its own directory at runtime.
  const nodeRequire =
    typeof __non_webpack_require__ === "function"
      ? __non_webpack_require__
      : require;

  const gluePath = path.join(ENGINE_DIR, "needle.js");
  const mod = nodeRequire(gluePath) as
    | CreateNeedle
    | { default: CreateNeedle };
  glueFactory = typeof mod === "function" ? mod : mod.default;
  return glueFactory;
}

// The engine is a process-global singleton: loading the 35 MB archive costs
// real time and memory, so it happens once and every request reuses it.
let enginePromise: Promise<NeedleEngine> | null = null;

export function getNeedleEngine(): Promise<NeedleEngine> {
  if (!enginePromise) {
    enginePromise = NeedleEngine.create().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

export class NeedleEngine {
  private wasm: NeedleWasm;
  private queue: Promise<unknown> = Promise.resolve();
  private outPtr: number;
  private initialised: string | null = null;
  private status: NeedleStatus;

  private constructor(wasm: NeedleWasm, status: NeedleStatus, outPtr: number) {
    this.wasm = wasm;
    this.status = status;
    this.outPtr = outPtr;
  }

  static async create(): Promise<NeedleEngine> {
    const createNeedle = loadGlue();
    const wasm = await createNeedle({
      locateFile: (file) => path.join(ENGINE_DIR, file),
    });

    const buf = fs.readFileSync(MODEL_PATH);
    const digest = crypto
      .createHash("sha256")
      .update(new Uint8Array(buf))
      .digest("hex");

    const cactPtr = wasm._malloc(buf.length);
    try {
      wasm.HEAPU8.set(new Uint8Array(buf), cactPtr);
      const rc = wasm._needle_load(cactPtr, BigInt(buf.length));
      if (rc < 0) {
        throw new Error(`needle_load failed with code ${rc}`);
      }
    } finally {
      wasm._free(cactPtr);
    }

    const outPtr = wasm._malloc(OUT_CAPACITY);
    return new NeedleEngine(
      wasm,
      {
        modelBytes: buf.length,
        modelSha256: digest.slice(0, 16),
        engine: "wasm",
        loaded: true,
      },
      outPtr,
    );
  }

  getStatus(): NeedleStatus {
    return this.status;
  }

  private allocString(value: string): number {
    const bytes = new TextEncoder().encode(`${value}\0`);
    const ptr = this.wasm._malloc(bytes.length);
    this.wasm.HEAPU8.set(bytes, ptr);
    return ptr;
  }

  // Serialise every entry point: the model is process-global and not
  // thread-safe, so two concurrent completes would corrupt the KV cache.
  private enqueue<T>(task: () => T): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Load the toolset once per (system, tools) pair. Re-initialising on every
   * request would rebuild the decode grammar and throw away the warm cache.
   */
  private ensureInitialised(system: string, toolsJson: string): void {
    const key = `${system}\u0000${toolsJson}`;
    if (this.initialised === key) return;

    const systemPtr = this.allocString(system);
    const toolsPtr = this.allocString(toolsJson);
    try {
      const rc = this.wasm._needle_init(systemPtr, toolsPtr, 0);
      if (rc < 0) {
        throw new Error(`needle_init failed with code ${rc}`);
      }
      this.initialised = key;
    } finally {
      this.wasm._free(systemPtr);
      this.wasm._free(toolsPtr);
    }
  }

  /**
   * One-shot completion. Resets conversation state first so requests stay
   * independent, then runs the grammar-constrained decode.
   */
  complete(
    input: string,
    options: { system: string; tools: unknown[]; maxNewTokens?: number },
  ): Promise<NeedleCompletion> {
    return this.enqueue(() => {
      const toolsJson = JSON.stringify(options.tools);
      this.ensureInitialised(options.system, toolsJson);
      this.wasm._needle_reset();

      const inputPtr = this.allocString(input);
      try {
        const n = this.wasm._needle_complete(
          inputPtr,
          options.maxNewTokens ?? 256,
          this.outPtr,
          OUT_CAPACITY,
        );
        if (n <= 0) {
          throw new Error(`needle_complete returned ${n}`);
        }
        return JSON.parse(
          this.wasm.UTF8ToString(this.outPtr),
        ) as NeedleCompletion;
      } finally {
        this.wasm._free(inputPtr);
      }
    });
  }
}

declare const __non_webpack_require__: NodeRequire;
