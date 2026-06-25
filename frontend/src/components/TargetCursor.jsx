import { useEffect, useState } from "react";
import "./App.css";
import TargetCursor from "./components/TargetCursor";

function App() {
  return (
    <div className="app">

      <TargetCursor
        spinDuration={2}
        hideDefaultCursor={true}
        parallaxOn={true}
        hoverDuration={0.2}
        cursorColor="#ffffff"
        cursorColorOnTarget="#B497CF"
      />

      <h1 className="cursor-target">
        StoreVision AI
      </h1>

      <button className="cursor-target">
        Click me!
      </button>

      <div className="cursor-target">
        Hover target
      </div>

    </div>
  );
}

export default App;