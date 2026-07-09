const API_BASE_URL = "http://127.0.0.1:8000";

export async function detectShelfImage(file) {
    if (!file) {
        throw new Error("No image selected");
    }

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE_URL}/detect`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Detection failed");
    }

    return await response.json();
}