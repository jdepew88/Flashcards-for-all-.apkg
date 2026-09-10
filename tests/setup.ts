import { MotionGlobalConfig } from "framer-motion";
import "@testing-library/jest-dom/vitest";

// jsdom does not implement these, and framer-motion / the viewer touch both.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom's Blob/File do not implement arrayBuffer(), which the .apkg parser
// calls to hand the upload to JSZip. Real browsers have had it for years; this
// fills the jsdom gap using FileReader, which jsdom does implement.
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
}

// Framer Motion's documented test hook: run animations to their final state
// immediately. Without it, exiting cards linger in the DOM in jsdom because
// nothing drives the animation frames to completion.
MotionGlobalConfig.skipAnimations = true;
