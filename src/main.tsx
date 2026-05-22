import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

// Log uncaught errors to help debug production issues
window.addEventListener("error", (e) => {
  const body = document.body;
  const div = document.createElement("div");
  div.style.cssText = "position:fixed;inset:0;z-index:99999;background:#1c1917;color:#fafaf9;padding:2rem;font-family:monospace;font-size:14px;overflow:auto;white-space:pre-wrap";
  div.textContent = `ERROR: ${e.message}\n\n${e.error?.stack || "(no stack)"}`;
  body.appendChild(div);
  console.error("Uncaught error:", e);
});

window.addEventListener("unhandledrejection", (e) => {
  const body = document.body;
  const div = document.createElement("div");
  div.style.cssText = "position:fixed;inset:0;z-index:99999;background:#1c1917;color:#fafaf9;padding:2rem;font-family:monospace;font-size:14px;overflow:auto;white-space:pre-wrap";
  div.textContent = `UNHANDLED REJECTION: ${e.reason?.message || e.reason}\n\n${e.reason?.stack || "(no stack)"}`;
  body.appendChild(div);
  console.error("Unhandled rejection:", e);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
