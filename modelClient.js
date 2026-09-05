// modelClient.js

// 各模型最大输出 token 上限（根据官方文档）
const MODEL_MAX_TOKENS = {
  'deepseek-v4-flash': 384000,      // 384K
  'deepseek-v4-pro': 384000,        // 384K
  'kimi-k2.6': 262144,              // 256K
  'kimi-k2.7-code': 262144,         // 256K
  'kimi-k2.7-code-highspeed': 262144, // 256K
  'kimi-k3': 1000000                // 1M
};

/**
 * 统一的模型请求接口
 * @param {string} modelName - 模型名称
 * @param {Array} messages - 消息列表
 * @param {Object} options - 自定义配置项
 */
async function callModel(modelName, messages, options = {}) {
  const deepseekModels = ['deepseek-v4-flash', 'deepseek-v4-pro'];
  const kimiStandardModels = ['kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed'];
  
  // 获取该模型的最大 token 上限，若用户传了 options.max_tokens 则优先使用用户的
  const maxTokens = options.max_tokens || MODEL_MAX_TOKENS[modelName] || 4096;

  // 1. DeepSeek 系列处理
  if (deepseekModels.includes(modelName)) {
    const apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY;
    const body = {
      model: modelName,
      messages: messages,
      max_tokens: maxTokens,
      temperature: options.temperature ?? 0.7,
      top_p: options.top_p ?? 1.0,
      stream: options.stream ?? false,
      ...(options.thinking ? { extra_body: { thinking: { type: 'enabled' } } } : {})
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
      reasoning_content: data.choices[0]?.message?.reasoning_content || null,
      usage: data.usage
    };
  }

  // 2. Kimi K3 强推理模型处理 (不能传 temperature / top_p)
  if (modelName === 'kimi-k3') {
    const apiKey = options.apiKey || process.env.KIMI_API_KEY;
    const body = {
      model: 'kimi-k3',
      messages: messages,
      max_tokens: maxTokens,
      reasoning_effort: options.reasoning_effort || 'high',
      stream: options.stream ?? false
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
      reasoning_content: data.choices[0]?.message?.reasoning_content || null,
      usage: data.usage
    };
  }

  // 3. Kimi 其他标准模型处理 (temperature 只能为 1)
  if (kimiStandardModels.includes(modelName)) {
    const apiKey = options.apiKey || process.env.KIMI_API_KEY;
    const body = {
      model: modelName,
      messages: messages,
      max_tokens: maxTokens,
      temperature: 1, // K2.6/K2.7 强制要求为 1
      stream: options.stream ?? false
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

  throw new Error(`Unsupported model: ${modelName}`);
}

module.exports = { callModel };