// Backend base URL. Override for phone/tunnel testing via frontend/.env.local:
//   VITE_API_BASE_URL=https://your-backend-tunnel-url
// If the env var is DEFINED but empty, calls are same-origin relative — which
// lets the app work behind any tunnel via the dev server's backend proxy,
// without knowing the tunnel URL in advance.
const configuredBase = import.meta.env.VITE_API_BASE_URL;
export const API_BASE_URL =
    configuredBase === undefined ? "http://127.0.0.1:8000" : configuredBase;

export async function detectShelfImage(file) {
    if (!file) {
        throw new Error("No image selected");
    }

    const formData = new FormData();
    formData.append("file", file);

    let response;
    try {
        response = await fetch(`${API_BASE_URL}/detect`, {
            method: "POST",
            body: formData,
            // Free ngrok tunnels answer browser requests with a warning page
            // unless this header is present. Harmless for direct connections.
            headers: { "ngrok-skip-browser-warning": "true" },
        });
    } catch {
        throw new Error(
            "Backend not reachable. Check VITE_API_BASE_URL or tunnel URL."
        );
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Detection failed");
    }

    return await response.json();
}
