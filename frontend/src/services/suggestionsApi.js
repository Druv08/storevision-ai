// Frontend helper for the StoreVision AI smart-suggestions API.
// Shares the backend base URL with the detection API so it also works behind
// the dev-server proxy / tunnel (same-origin) instead of a hardcoded port.
import { API_BASE_URL } from "./detectionApi";

export async function fetchSmartSuggestions() {
  const response = await fetch(`${API_BASE_URL}/smart-suggestions`);

  if (!response.ok) {
    throw new Error("Failed to fetch smart suggestions");
  }

  return response.json();
}
