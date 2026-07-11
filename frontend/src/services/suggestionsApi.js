// Frontend helper for the StoreVision AI smart-suggestions API.

const API_BASE_URL = "http://127.0.0.1:8000";

export async function fetchSmartSuggestions() {
  const response = await fetch(`${API_BASE_URL}/smart-suggestions`);

  if (!response.ok) {
    throw new Error("Failed to fetch smart suggestions");
  }

  return response.json();
}
