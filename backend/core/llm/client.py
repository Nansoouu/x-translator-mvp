"""
client.py - Client Ollama OpenAI-compatible avec timeout et fallback
"""
from openai import AsyncOpenAI, OpenAI
from typing import Optional
import os
import asyncio


class LocalLLMClient:
    """Client Ollama minimaliste - configurable via env variables"""

    def __init__(
        self,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.25,
        max_tokens: int = 8192,
        timeout: float = 30.0,
    ):
        # Configuration depuis env variables ou valeurs par défaut
        self.base_url = base_url or os.environ.get(
            "OLLAMA_BASE_URL", "http://localhost:8082/v1"
        )
        self.model = model or os.environ.get("OLLAMA_MODEL", "Qwen3.5-9B")
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout

        # Clients avec timeout
        self.async_client = AsyncOpenAI(
            base_url=self.base_url,
            api_key="ollama",
            timeout=self.timeout
        )
        self.sync_client = OpenAI(
            base_url=self.base_url,
            api_key="ollama",
            timeout=self.timeout
        )
        print(f"[LocalLLMClient] Config: {self.base_url}, model={self.model}, timeout={timeout}s")

    async def generate(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Génération asynchrone - lève Exception si Ollama échoue"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        response = await self.async_client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )
        return response.choices[0].message.content.strip()

    def generate_sync(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Version synchrone (pour asyncio.to_thread)"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        response = self.sync_client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )
        return response.choices[0].message.content.strip()