"use server";

// Scripted stand-ins for the preview page only. No database, no session, no model.
export async function previewSend() {
  return { conversationId: "c1", reply: "This is a preview." };
}
export async function previewConfirm() {
  return { ok: true as const };
}
export async function previewClear() {}
