#!/bin/bash

# Default model configuration
DEFAULT_SMALL_MODEL="gpt-4o-mini"
DEFAULT_LARGE_MODEL="o3"
USE_LARGE_MODEL=false

# Parse command line options
while getopts "lh" opt; do
    case $opt in
    l)
        USE_LARGE_MODEL=true
        ;;
    h)
        # Load env variables first to show actual models
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        if [ -f "$SCRIPT_DIR/.env" ]; then
            export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs) 2>/dev/null
        fi
        SMALL_MODEL="${OPENAI_SMALL_MODEL:-$DEFAULT_SMALL_MODEL}"
        LARGE_MODEL="${OPENAI_LARGE_MODEL:-$DEFAULT_LARGE_MODEL}"

        echo "Usage: $0 [-l] <input text>"
        echo "  -l    Use large model instead of default small model"
        echo ""
        echo "Current model configuration:"
        echo "  Small model: $SMALL_MODEL"
        echo "  Large model: $LARGE_MODEL"
        exit 0
        ;;
    \?)
        echo "Invalid option: -$OPTARG" >&2
        exit 1
        ;;
    esac
done

# Shift past the options
shift $((OPTIND - 1))

# Check if input is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 [-l] <input text>"
    echo "  -l    Use large model instead of default small model"
    exit 1
fi

# Load environment variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
    export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
fi

# Set actual model values after loading env
SMALL_MODEL="${OPENAI_SMALL_MODEL:-$DEFAULT_SMALL_MODEL}"
LARGE_MODEL="${OPENAI_LARGE_MODEL:-$DEFAULT_LARGE_MODEL}"

# Check if API key is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "Error: OPENAI_API_KEY not found in .env file"
    echo "Please set OPENAI_API_KEY in your .env file"
    exit 1
fi

# Combine all arguments as input text
INPUT_TEXT="$*"

# Select model based on flag
if [ "$USE_LARGE_MODEL" = true ]; then
    MODEL="$LARGE_MODEL"
else
    MODEL="$SMALL_MODEL"
fi

# Make API request to OpenAI
response=$(curl -s https://api.openai.com/v1/responses \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d "{
    \"model\": \"$MODEL\",
    \"tools\": [{\"type\": \"web_search_preview\"}],
    \"input\": \"$INPUT_TEXT\"
  }")

# Check if curl was successful
if [ $? -ne 0 ]; then
    echo "Error: Failed to connect to OpenAI API"
    exit 1
fi

# Debug: Show raw response if needed
# echo "Raw response: $response" >&2

# Extract and display the response - adjust for the actual response structure
content=$(echo "$response" | jq -r '.output[] | select(.type == "message") | .content[0].text' 2>/dev/null)

if [ -z "$content" ] || [ "$content" = "null" ]; then
    echo "Error: Failed to parse response or empty content"
    echo "Response: $response"
    exit 1
fi

echo "$content"
