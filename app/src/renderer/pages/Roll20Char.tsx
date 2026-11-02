import { useEffect } from "react";

export default function Roll20Char() {
  useEffect(() => {
    window.browserAPI?.loadBrowserChild(true, "https://roll20.net/");

    return () => {
      window.browserAPI?.loadBrowserChild(false, "");
    };
  }, []);

  return <div className="flex flex-cols gap-2"></div>;
}
