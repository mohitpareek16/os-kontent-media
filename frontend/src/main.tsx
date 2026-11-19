import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import { registerServiceWorker } from "./lib/push";
import "./index.css";

const queryClient = new QueryClient();

/* The service worker is what receives a push when no tab is open, so it has
 * to exist before anyone can subscribe. Registering it is not the same as
 * asking for permission — that happens from a button, never on load — and a
 * failed registration only means no desktop alerts, so it deliberately does
 * not block or break the app. See `lib/push.ts`. */
void registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
