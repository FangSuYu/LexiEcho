const MODEL_MAX_TOKENS = {
  'deepseek-v4-flash': 384000,
  'deepseek-v4-pro': 384000,
  'kimi-k2.6': 262144,
  'kimi-k2.7-code': 262144,
  'kimi-k2.7-code-highspeed': 262144,
  'kimi-k3': 1000000
};

/**
 * 统一模型请求入口
 */
async function callModel(modelName, messages, options = {}) {
  const deepseekModels = ['deepseek-v4-flash', 'deepseek-v4-pro'];
  const kimiStandardModels = ['kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed'];
  
  const maxTokens = options.max_tokens || MODEL_MAX_TOKENS[modelName] || 4096;

  // DeepSeek 处理
  if (deepseekModels.includes(modelName)) {
    const apiKey = options.apiKey;
    const body = {
      model: modelName,
      messages: messages,
      max_tokens: maxTokens,
      temperature: options.temperature ?? 0.7,
      top_p: options.top_p ?? 1.0,
      stream: false
    };

    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`DeepSeek API Error [${res.status}]: ${await res.text()}`);
    const data = await res.json();
    
    return {
      content: data.choices[0]?.message?.content || '',
      usage: data.usage
    };
  }

  // Kimi K3 处理
  if (modelName === 'kimi-k3') {
    const apiKey = options.apiKey;
    const body = {
      model: 'kimi-k3',
      messages: messages,
      max_tokens: maxTokens,
      reasoning_effort: options.reasoning_effort || 'high',
      stream: false
    };

    const res = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`Kimi K3 API Error [${res.status}]: ${await res.text()}`);
    const data = await res.json();

    return {
      content: data.choices[0]?.message?.content || '',
      usage: data.usage
    };
  }

  // Kimi 标准模型处理
  if (kimiStandardModels.includes(modelName)) {
    const apiKey = options.apiKey;
    const body = {
      model: modelName,
      messages: messages,
      max_tokens: maxTokens,
      temperature: 1,
      stream: false
    };

    const res = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`Kimi Standard API Error [${res.status}]: ${await res.text()}`);
    const data = await res.json();

    return {
      content: data.choices[0]?.message?.content || '',
      usage: data.usage
    };
  }

  throw new Error(`不支持的模型类别: ${modelName}`);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { callModel };
}