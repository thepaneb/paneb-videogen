import fs from "node:fs";
import { log } from "../log.js";
import { VideoProvider } from "../model.js";
import { mockProvider } from "./mock.js";
import { klingProvider } from "./kling.js";
import { comfyProvider } from "./comfyui.js";
import { comfyWanProvider } from "./comfyui-wan.js";
import { comfyWan13Provider } from "./comfyui-wan13.js";
import { comfyWanfunProvider } from "./comfyui-wanfun.js";

export function registry(): Record<string, VideoProvider> {
  const r: Record<string, VideoProvider> = { mock: mockProvider };
  if (process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY) r.kling = klingProvider;
  const wfs = [process.env.COMFY_WORKFLOW, process.env.COMFY_WORKFLOW_I2V];
  if (wfs.some((f) => f && fs.existsSync(f))) r.comfyui = comfyProvider;
  const wanWfs = [process.env.COMFY_WORKFLOW_WAN, process.env.COMFY_WORKFLOW_WAN_I2V];
  if (wanWfs.some((f) => f && fs.existsSync(f))) r["comfyui-wan"] = comfyWanProvider;
  const wan13Wf = process.env.COMFY_WORKFLOW_WAN13;
  if (wan13Wf && fs.existsSync(wan13Wf)) r["comfyui-wan13"] = comfyWan13Provider;
  const wanfunWf = process.env.COMFY_WORKFLOW_WANFUN;
  if (wanfunWf && fs.existsSync(wanfunWf)) r["comfyui-wanfun"] = comfyWanfunProvider;
  return r;
}
export const defaultProvider = () => {
  const want = process.env.PROVIDER ?? "mock";
  if (want in registry()) return want;
  log.warn("provedor desconhecido; usando mock", { want });
  return "mock";
};
