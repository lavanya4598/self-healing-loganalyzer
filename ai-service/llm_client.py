from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.schema import HumanMessage, SystemMessage
from config import LLM_PROVIDER, OPENAI_API_KEY, GOOGLE_API_KEY, OPENAI_MODEL, GOOGLE_MODEL


def get_llm(temperature: float = 0.1):
    """Factory to return the configured LLM."""
    if LLM_PROVIDER == "google":
        return ChatGoogleGenerativeAI(
            model=GOOGLE_MODEL,
            google_api_key=GOOGLE_API_KEY,
            temperature=temperature,
            convert_system_message_to_human=True,
        )
    return ChatOpenAI(
        model=OPENAI_MODEL,
        openai_api_key=OPENAI_API_KEY,
        temperature=temperature,
    )


def chat(system_prompt: str, user_prompt: str, temperature: float = 0.1) -> str:
    """Convenience wrapper for a single chat completion."""
    llm = get_llm(temperature)
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]
    response = llm.invoke(messages)
    return response.content
