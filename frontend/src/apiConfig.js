// Empty string = relative URL = goes through Vite's dev proxy to the backend.
// Set VITE_API_URL only for production deployments where backend is on a different domain.
const API_URL = import.meta.env.VITE_API_URL || '';

export default API_URL;
