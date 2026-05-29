# pi-stepfun-provider

A Pi extension that registers [StepFun](https://platform.stepfun.com) as a model provider, giving you access to StepFun LLMs (step-1, step-2, step-3.x series) through a single API key.

## Features

- **Dynamic model discovery** — Fetches the full model catalog from StepFun's `/v1/models` endpoint at startup
- **Heuristic specs** — Context windows, max tokens, and vision/reasoning support inferred from model naming patterns
- **Reasoning support** — Models with `reasoning_effort` support (step-3.5-flash, step-3.7) are flagged automatically
- **Vision support** — Multimodal models (step-1v, step-2+, step-3.x) are detected from naming patterns

## Install

```bash
pi install git:github.com/markg85/pi-stepfun-provider
```

## Configuration

### Option 1: `/login` (recommended)

Run Pi's built-in login command to store your API key in Pi's credential store:

```
/login stepfun
```

You'll be prompted for your StepFun API key. The key is validated against the API and stored securely in `~/.pi/agent/auth.json`. No environment variable needed.

### Option 2: Environment variable

```bash
export STEPFUN_API_KEY="your-api-key"
```

Or add it to your Pi settings (`.pi/settings.json` or `~/.pi/agent/settings.json`):

```json
{
  "env": {
    "STEPFUN_API_KEY": "your-api-key"
  }
}
```

> **Note:** Credentials from `/login` take priority over the environment variable.

## Usage

After installation, StepFun models are available in Pi:

```bash
# List all StepFun models
pi --list-models | grep stepfun

# Use a specific model
pi --model stepfun:step-3.5-flash

# Use a vision model
pi --model stepfun:step-2-16k
```

## API Details

StepFun uses the **OpenAI Chat Completions** compatible API. This extension uses the **Step Plan** channel at `https://api.stepfun.ai/step_plan/v1`, which provides access to all StepFun models including the `step-router-v1` routing model.

## License

MIT
