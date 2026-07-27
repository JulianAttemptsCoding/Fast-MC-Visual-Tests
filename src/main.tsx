import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ZdcDashboard } from "./ZdcDashboard";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ZdcDashboard />
  </StrictMode>,
);
