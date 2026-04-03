#!/usr/bin/env python3
"""
Test suite for temporal context disambiguation in agent memories.

This validates that the enhanced cognee service correctly distinguishes
between planning statements ("plan to invest") and completion statements
("have invested").
"""
import asyncio
import aiohttp
import json
from datetime import datetime

# Test cases that should be disambiguated
TEST_CASES = [
    {
        "category": "planning",
        "messages": [
            "We plan to invest in company Alpha next quarter",
            "Going to acquire Beta Corp if the diligence goes well", 
            "Will consider a Series A investment in Gamma Inc",
            "Exploring a potential partnership with Delta Labs",
            "Roadmap includes expansion into European markets",
            "If valuations correct, might invest in PropTech",
        ]
    },
    {
        "category": "completion", 
        "messages": [
            "We have invested $2M in company Alpha",
            "Successfully acquired Beta Corp last month",
            "Closed the Series A investment in Gamma Inc",
            "Announced partnership with Delta Labs yesterday", 
            "Our investment in Epsilon is generating strong returns",
            "Portfolio company Zeta launched their new product",
        ]
    },
    {
        "category": "present",
        "messages": [
            "Currently working with Alpha on their go-to-market",
            "Beta is building their engineering team",
            "Gamma is raising their Series B round",
        ]
    },
    {
        "category": "neutral",
        "messages": [
            "The weather is nice today",
            "Engineering best practices for startups",
            "Market research on AI companies",
        ]
    }
]

# Queries that should return contextually appropriate results
QUERIES = [
    {
        "query": "what companies have we invested in",
        "expected_contexts": ["completion", "present"],
        "unexpected_contexts": ["planning"]
    },
    {
        "query": "what investments are we planning",
        "expected_contexts": ["planning"],  
        "unexpected_contexts": ["completion"]
    },
    {
        "query": "which companies are we considering",
        "expected_contexts": ["planning"],
        "unexpected_contexts": ["completion"]
    },
    {
        "query": "portfolio companies",
        "expected_contexts": ["completion", "present"],
        "unexpected_contexts": ["planning"]
    }
]

async def test_temporal_detection():
    """Test the temporal context detection endpoint."""
    print("🔍 Testing temporal context detection...")
    
    async with aiohttp.ClientSession() as session:
        for category_data in TEST_CASES:
            category = category_data["category"]
            print(f"\n  Testing {category} messages:")
            
            for message in category_data["messages"]:
                async with session.get(f"http://localhost:3002/debug/temporal/{message}") as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        detected = data["temporal_context"]
                        
                        # Check if detection matches expected category
                        status = "✅" if detected == category else "❌"
                        print(f"    {status} '{message[:50]}...' -> {detected}")
                        
                        if detected != category:
                            print(f"         Expected: {category}, Got: {detected}")
                    else:
                        print(f"    ❌ Error testing: {message[:50]}...")

async def test_memory_ingestion():
    """Test ingestion of messages with temporal context."""
    print("\n📥 Testing memory ingestion...")
    
    test_agent_id = "test-agent-temporal-123"
    
    async with aiohttp.ClientSession() as session:
        message_count = 0
        for category_data in TEST_CASES:
            for message in category_data["messages"]:
                payload = {
                    "agentId": test_agent_id,
                    "text": message,
                    "metadata": {
                        "channelId": "test-channel",
                        "messageId": f"msg-{message_count}",
                        "userId": "test-user",
                        "timestamp": datetime.now().isoformat()
                    }
                }
                
                async with session.post(
                    "http://localhost:3002/ingest",
                    json=payload
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        detected = data.get("detected_temporal_context", "unknown")
                        print(f"    ✅ Ingested: {message[:30]}... (detected: {detected})")
                    else:
                        print(f"    ❌ Failed to ingest: {message[:30]}...")
                        error = await resp.text()
                        print(f"       Error: {error}")
                
                message_count += 1
    
    print(f"    📊 Ingested {message_count} test messages")
    return test_agent_id

async def test_contextual_queries(agent_id: str):
    """Test that queries return contextually appropriate results."""
    print("\n🔍 Testing contextual queries...")
    
    async with aiohttp.ClientSession() as session:
        for query_test in QUERIES:
            query = query_test["query"]
            expected = query_test["expected_contexts"]
            unexpected = query_test["unexpected_contexts"]
            
            print(f"\n  Query: '{query}'")
            print(f"    Expected contexts: {expected}")
            print(f"    Should NOT return: {unexpected}")
            
            payload = {
                "agentId": agent_id,
                "query": query,
                "limit": 10
            }
            
            async with session.post(
                "http://localhost:3002/query", 
                json=payload
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    results = data.get("results", [])
                    query_context = data.get("query_temporal_context", "unknown")
                    
                    print(f"    Query context detected as: {query_context}")
                    print(f"    Found {len(results)} results:")
                    
                    context_counts = {}
                    contamination_found = False
                    
                    for i, result in enumerate(results[:5]):  # Show first 5
                        text = result.get("text", "")
                        result_context = result.get("temporal_context", "unknown")
                        
                        context_counts[result_context] = context_counts.get(result_context, 0) + 1
                        
                        # Check for contamination
                        if result_context in unexpected:
                            contamination_found = True
                            print(f"      ❌ [{result_context}] {text[:60]}...")
                        else:
                            print(f"      ✅ [{result_context}] {text[:60]}...")
                    
                    # Summary
                    if contamination_found:
                        print(f"    ⚠️  CONTAMINATION DETECTED in query '{query}'")
                    else:
                        print(f"    ✅ No contamination found")
                        
                    print(f"    Context distribution: {context_counts}")
                    
                else:
                    print(f"    ❌ Query failed: {await resp.text()}")

async def test_service_health():
    """Test that the enhanced service is running."""
    print("🏥 Testing service health...")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get("http://localhost:3002/health") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"    ✅ Service healthy")
                    print(f"       Version: {data.get('version', 'unknown')}")
                    print(f"       Backend: {data.get('backend', 'unknown')}")
                    print(f"       Features: {data.get('features', [])}")
                    return True
                else:
                    print(f"    ❌ Service unhealthy: {resp.status}")
                    return False
    except Exception as e:
        print(f"    ❌ Cannot connect to service: {e}")
        return False

async def main():
    """Run the full test suite."""
    print("🧪 Temporal Context Disambiguation Test Suite")
    print("=" * 50)
    
    # Test 1: Service health
    if not await test_service_health():
        print("\n❌ Cannot proceed - service not available")
        print("   Make sure the enhanced cognee service is running:")
        print("   python cognee-service-v2.py")
        return
    
    # Test 2: Temporal detection
    await test_temporal_detection()
    
    # Test 3: Memory ingestion
    agent_id = await test_memory_ingestion()
    
    # Wait a moment for indexing
    print("\n⏳ Waiting 2 seconds for indexing...")
    await asyncio.sleep(2)
    
    # Test 4: Contextual queries
    await test_contextual_queries(agent_id)
    
    print("\n🏁 Test suite complete!")
    print("\nTo manually test contamination:")
    print("1. Ingest: 'We plan to invest in CompanyX'")
    print("2. Query: 'what companies have we invested in'") 
    print("3. CompanyX should NOT appear in results")

if __name__ == "__main__":
    asyncio.run(main())