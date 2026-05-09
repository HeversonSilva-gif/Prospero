import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./i18n/index.js";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
