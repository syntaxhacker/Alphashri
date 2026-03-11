#!/usr/bin/env python3
"""
Test script for OpenRouter API connection with z-ai/glm-4.5-air:free model.
Tests basic functionality and tool calling capabilities.
"""

import json
import os
import sys
import logging
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

# Model configuration
MODEL_NAME = "z-ai/glm-4.5-air:free"

def test_basic_connection():
    """Test basic API connection with a simple prompt."""
    print("=" * 60)
    print("Testing Basic OpenRouter Connection")
    print("=" * 60)
    
    try:
        # Initialize OpenRouter client with the same configuration as app.py
        openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
        if not openrouter_api_key:
            print("❌ OPENROUTER_API_KEY not found in environment variables")
            return False
            
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=openrouter_api_key
        )
        
        # Test with a simple prompt
        messages = [
            {"role": "user", "content": "Hello! Please respond with a simple greeting and your name."}
        ]
        
        print("Sending test request to OpenRouter API...")
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages
        )
        
        # Extract and display the response
        content = response.choices[0].message.content
        print(f"✅ SUCCESS: API connection works!")
        print(f"Model: {response.model}")
        print(f"Response: {content}")
        print(f"Usage: {response.usage}")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Basic connection test failed")
        print(f"Error: {str(e)}")
        return False

def test_tool_calling():
    """Test tool calling functionality."""
    print("\n" + "=" * 60)
    print("Testing Tool Calling Functionality")
    print("=" * 60)
    
    try:
        # Initialize OpenRouter client
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.getenv("OPENROUTER_API_KEY")
        )
        
        # Define test tools (similar to app.py)
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "Get current weather information",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": {
                                "type": "string",
                                "description": "The city name for weather information"
                            }
                        },
                        "required": ["location"]
                    }
                }
            }
        ]
        
        # Test prompt that should trigger tool calling
        messages = [
            {"role": "user", "content": "What's the weather like in New York?"}
        ]
        
        print("Sending test request with tool calling capability...")
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,
            tools=tools
        )
        
        # Analyze the response
        finish_reason = response.choices[0].finish_reason
        message = response.choices[0].message
        
        print(f"✅ SUCCESS: Tool calling test completed!")
        print(f"Model: {response.model}")
        print(f"Finish Reason: {finish_reason}")
        
        if finish_reason == "tool_calls":
            print("🔧 Tool calls detected:")
            if hasattr(message, 'tool_calls') and message.tool_calls:
                for tool_call in message.tool_calls:
                    print(f"  - Tool: {tool_call.function.name}")
                    print(f"  - Arguments: {tool_call.function.arguments}")
            else:
                print("  - No tool calls found in response")
        else:
            print(f"  - Response content: {message.content}")
        
        print(f"Usage: {response.usage}")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Tool calling test failed")
        print(f"Error: {str(e)}")
        return False

def test_error_handling():
    """Test error handling with invalid requests."""
    print("\n" + "=" * 60)
    print("Testing Error Handling")
    print("=" * 60)
    
    try:
        # Initialize OpenRouter client
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.getenv("OPENROUTER_API_KEY")
        )
        
        # Test with empty messages
        print("Testing empty messages...")
        try:
            response = client.chat.completions.create(
                model="z-ai/glm-4.5-air:free",
                messages=[]
            )
            print("⚠️  Unexpected: Empty messages request succeeded")
        except Exception as e:
            print(f"✅ Expected error caught: {str(e)}")
        
        # Test with invalid model
        print("Testing invalid model...")
        try:
            response = client.chat.completions.create(
                model="invalid-model-name",
                messages=[{"role": "user", "content": "Hello"}]
            )
            print("⚠️  Unexpected: Invalid model request succeeded")
        except Exception as e:
            print(f"✅ Expected error caught: {str(e)}")
        
        print("✅ SUCCESS: Error handling tests completed")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Error handling test failed")
        print(f"Error: {str(e)}")
        return False

def test_conversation_flow():
    """Test a multi-turn conversation."""
    print("\n" + "=" * 60)
    print("Testing Multi-turn Conversation")
    print("=" * 60)
    
    try:
        # Initialize OpenRouter client
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.getenv("OPENROUTER_API_KEY")
        )
        
        # Simulate a conversation
        messages = [
            {"role": "user", "content": "Hello! Can you help me understand what AI is?"}
        ]
        
        print("Starting conversation flow...")
        
        # First turn
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages
        )
        
        content = response.choices[0].message.content
        print(f"Assistant: {content}")
        
# Second turn
        messages.append({"role": "assistant", "content": content})
        messages.append({"role": "user", "content": "Can you give me a simple example?"})
        
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages
        )
        
        content = response.choices[0].message.content
        print(f"Assistant: {content}")
        
        print("✅ SUCCESS: Multi-turn conversation completed")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Conversation flow test failed")
        print(f"Error: {str(e)}")
        return False

def main():
    """Main test function."""
    print("🚀 Starting OpenRouter API Connection Tests")
    print(f"Model: {MODEL_NAME}")
    print(f"API Base URL: https://openrouter.ai/api/v1")
    
    # Run all tests
    tests = [
        ("Basic Connection", test_basic_connection),
        ("Tool Calling", test_tool_calling),
        ("Error Handling", test_error_handling),
        ("Conversation Flow", test_conversation_flow)
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"❌ CRITICAL ERROR in {test_name}: {str(e)}")
            results.append((test_name, False))
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = 0
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test_name}")
        if result:
            passed += 1
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! OpenRouter integration is working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed. Please check the configuration and API credentials.")
        return 1

if __name__ == "__main__":
    sys.exit(main())