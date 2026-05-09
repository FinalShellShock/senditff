import { useOutletContext } from "react-router-dom";
import type { LeagueOutletContext } from "./LeagueShell.tsx";

export default function Calc() {
  useOutletContext<LeagueOutletContext>();
  return (
    <div style={{ paddingTop: 48, textAlign: "center" }}>
      <p className="dim-text" style={{ fontSize: 14, marginBottom: 8 }}>CALC</p>
      <p className="dim-text">Coming soon — paste in both sides of any trade to get an instant verdict.</p>
    </div>
  );
}
