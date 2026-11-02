import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { HashRouter, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Roll20Char from "./pages/Roll20Char";
import Navbar from "./components/Navbar";
import BackgroundMusicLooper from "./pages/BackgroundMusicLooper";
import Container from "./components/Container";

const App = () => {
  return (
    <HashRouter>
      <div className="flex flex-col">
        <Navbar />
        <main className="min-h-0 flex-1 overflow-auto">
          <Container>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/roll20" element={<Roll20Char />} />
              <Route
                path="/background-music-looper"
                element={<BackgroundMusicLooper />}
              />
            </Routes>
          </Container>
        </main>
      </div>
    </HashRouter>
  );
};

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
