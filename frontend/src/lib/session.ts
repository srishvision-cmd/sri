// Session boundary: auth is an httpOnly cookie the backend owns; the frontend's one
// duty is wiping the react-query cache so one account's data never renders for the next.
import { queryClient } from "./queryClient";
import { apiPost } from "./api";

// Call after every successful login/signup.
export function beginSession(): void {
  queryClient.clear();
}

export const IDLE_MINUTES = 15; // mirrors backend lib/auth.SESSION_MINUTES

// Logs the user out after IDLE_MINUTES without mouse / keyboard / touch; while active,
// pings the backend at most every 2 min so the sliding cookie stays in step.
export function startIdleLogout(): () => void {
  let last = Date.now();
  let lastPing = Date.now();
  const onActivity = () => {
    last = Date.now();
    if (last - lastPing > 120_000) {
      lastPing = last;
      void apiPost("/auth/ping").catch(() => undefined);
    }
  };
  const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;
  events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
  const timer = window.setInterval(() => {
    if (Date.now() - last > IDLE_MINUTES * 60_000) void endSession("/login?reason=idle");
  }, 15_000);
  return () => {
    events.forEach((e) => window.removeEventListener(e, onActivity));
    window.clearInterval(timer);
  };
}

// Call from every sign-out control; the hard redirect resets all in-memory state.
export async function endSession(redirectTo: string = "/login"): Promise<void> {
  try {
    await apiPost("/auth/logout");
  } finally {
    queryClient.clear();
    window.location.assign(redirectTo);
  }
}
