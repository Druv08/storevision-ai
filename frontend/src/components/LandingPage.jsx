import SmartShelf from "./SmartShelf";
import "./LandingPage.css";

export default function LandingPage() {
  return (
    <div className="landing-page">
      <div className="hero-content">
        <h1>StoreVision AI</h1>

        <p>Intelligent shelf monitoring powered by AI</p>

        <div className="shelf-stage">
          <SmartShelf />

          <div className="scan-beam"></div>
        </div>

        <div className="pull-text">Pull the shelf to enter ↓</div>
      </div>
    </div>
  );
}
