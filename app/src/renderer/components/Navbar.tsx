import { NavLink } from "react-router-dom";

const itemClass = ({ isActive }: { isActive: boolean }) =>
  `text-lg ${isActive ? "text-blue-500" : ""}`;

export default function Navbar() {
  return (
    <nav className="flex shrink-0 items-center gap-4 border-b">
      <NavLink to="/" className={itemClass}>
        HOME
      </NavLink>
      <NavLink to="/roll20" className={itemClass}>
        Roll 20 Character
      </NavLink>
      <NavLink to="/background-music-looper" className={itemClass}>
        Background Music Looper
      </NavLink>
    </nav>
  );
}
