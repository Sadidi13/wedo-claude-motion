"use client";
/**
 * Motion Studio entry page: the whole editor is a client component (store,
 * iframe preview, keyboard shortcuts). Browser APIs are only touched inside
 * effects, so the first server render is a static shell.
 */
import Editor from "@/components/Editor";

export default function Home() {
  return <Editor />;
}
