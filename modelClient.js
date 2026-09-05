  // modelClient.js

/**
 * 统一的模型请求接口
 * @param {string} modelName - 模型名称
 * @param {Array} messages - 消息列表
 * @param {Object} options - 自定义配置项
 */
async function callModel(modelName, messages, options = {}) {
  const deepseekModels = ['deepseek-v4-flash', 'deepseek-v4-pro'];
  const kimiStandardModels = ['kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed'];
  
  // 1. DeepSeek 系列处理
  if (deepseekModels.includes(modelName)) {
    const apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY;
    const body = {
      model: modelName,
      messages: messages,
      max_tokens: options.max_tokens || (modelName === 'deepseek-v4-pro' ? 2048 : 1024),
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
      max_tokens: options.max_tokens || 2048,
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
      max_tokens: options.max_tokens || 1024,
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