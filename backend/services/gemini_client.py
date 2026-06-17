"""
Gemini AI Client - Replaces Groq with Google Gemini 2.5 Flash
"""
import os
import json
from dotenv import load_dotenv

load_dotenv()

def get_gemini_api_key():
    """Get the Gemini API key from environment."""
    load_dotenv(override=False)
    return os.getenv("GEMINI_API_KEY")

def has_gemini_key() -> bool:
    """Checks if Gemini API key is present."""
    return get_gemini_api_key() is not None and len(get_gemini_api_key().strip()) > 0

# Legacy aliases so existing code that checks groq_client.has_groq_key() still works
has_groq_key = has_gemini_key

def call_gemini(prompt: str, system_prompt: str = "You are a helpful assistant.", temperature: float = 0.1, json_mode: bool = True) -> dict:
    """
    Calls Google Gemini 2.5 Flash API and returns parsed JSON response.
    """
    import google.generativeai as genai
    
    api_key = get_gemini_api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured in environment.")
    
    genai.configure(api_key=api_key)
    
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=system_prompt,
        generation_config=genai.GenerationConfig(
            temperature=temperature,
            response_mime_type="application/json" if json_mode else "text/plain",
        )
    )
    
    response = model.generate_content(prompt)
    
    content = response.text.strip()
    
    if json_mode:
        # Clean markdown code blocks if present
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
        if content.endswith("```"):
            content = content[:-3].strip()
        content = content.replace("```json", "").replace("```", "").strip()
        
        return json.loads(content)
    
    return {"text": content}

def call_gemini_text(prompt: str, system_prompt: str = "You are a helpful assistant.", temperature: float = 0.1) -> str:
    """
    Calls Gemini and returns plain text response.
    """
    result = call_gemini(prompt, system_prompt, temperature, json_mode=False)
    return result.get("text", "")

# Legacy compatibility for interview_evaluation.py and ai_generator.py
def execute_groq_request(url: str, payload: dict, timeout: int = 30):
    """
    Legacy wrapper: Translates old Groq HTTP request format to Gemini SDK call.
    Returns a mock response object compatible with the old code.
    """
    messages = payload.get("messages", [])
    system_msg = ""
    user_msg = ""
    
    for msg in messages:
        if msg["role"] == "system":
            system_msg = msg["content"]
        elif msg["role"] == "user":
            user_msg = msg["content"]
    
    temperature = payload.get("temperature", 0.1)
    json_mode = payload.get("response_format", {}).get("type") == "json_object"
    
    result = call_gemini(user_msg, system_msg, temperature, json_mode)
    
    # Create a mock response object that mimics requests.Response
    class MockResponse:
        def __init__(self, data):
            self.status_code = 200
            self._data = data
            self.text = json.dumps(data)
        
        def json(self):
            return {
                "choices": [{
                    "message": {
                        "content": json.dumps(self._data)
                    }
                }]
            }
        
        def raise_for_status(self):
            pass
    
    return MockResponse(result)

def call_groq_sdk(fn, *args, **kwargs):
    """
    Legacy wrapper for interview_evaluation.py: Translates Groq SDK calls to Gemini.
    """
    import google.generativeai as genai
    
    api_key = get_gemini_api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured in environment.")
    
    genai.configure(api_key=api_key)
    
    # Create a mock client that the fn can use
    class MockGroqClient:
        class chat:
            class completions:
                @staticmethod
                def create(**kwargs):
                    messages = kwargs.get("messages", [])
                    system_msg = ""
                    user_msg = ""
                    for msg in messages:
                        if msg["role"] == "system":
                            system_msg = msg["content"]
                        elif msg["role"] == "user":
                            user_msg = msg["content"]
                    
                    model = genai.GenerativeModel(
                        model_name="gemini-2.5-flash",
                        system_instruction=system_msg,
                        generation_config=genai.GenerationConfig(
                            temperature=kwargs.get("temperature", 0.1),
                            response_mime_type="application/json" if kwargs.get("response_format", {}).get("type") == "json_object" else "text/plain",
                        )
                    )
                    
                    response = model.generate_content(user_msg)
                    
                    # Return mock response matching Groq SDK format
                    class Choice:
                        def __init__(self, text):
                            self.message = type('obj', (object,), {'content': text})()
                    
                    class MockCompletion:
                        def __init__(self, text):
                            self.choices = [Choice(text)]
                    
                    return MockCompletion(response.text.strip())
    
    return fn(MockGroqClient(), *args, **kwargs)
