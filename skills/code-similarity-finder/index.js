#!/usr/bin/env node
/**
 * Code Similarity Finder - MCP Server
 * 
 * 查找相似的代码实现，帮助发现可参考的模式
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');

/**
 * 提取 Go 文件的特征
 */
function extractGoFeatures(content, filePath) {
  const features = {
    filePath,
    resourceType: null,
    hasCreate: false,
    hasRead: false,
    hasUpdate: false,
    hasDelete: false,
    schemaFields: [],
    imports: [],
    functions: [],
  };
  
  // 提取资源类型（从文件名或 ResourceType 定义）
  const resourceTypeMatch = content.match(/ResourceType:\s*"([^"]+)"/);
  if (resourceTypeMatch) {
    features.resourceType = resourceTypeMatch[1];
  } else {
    // 从文件名推断
    const baseName = path.basename(filePath, '.go');
    features.resourceType = baseName.replace(/_resource$|_data_source$/, '');
  }
  
  // 检测 CRUD 函数
  features.hasCreate = /func\s+\([^)]+\)\s+Create\(|CreateFunc:|Create:\s*func/.test(content);
  features.hasRead = /func\s+\([^)]+\)\s+Read\(|ReadFunc:|Read:\s*func/.test(content);
  features.hasUpdate = /func\s+\([^)]+\)\s+Update\(|UpdateFunc:|Update:\s*func/.test(content);
  features.hasDelete = /func\s+\([^)]+\)\s+Delete\(|DeleteFunc:|Delete:\s*func/.test(content);
  
  // 提取 Schema 字段名
  const schemaPattern = /"([a-z_]+)":\s*(?:pluginsdk\.)?Schema\s*{|"([a-z_]+)":\s*{[\s\S]*?Type:/g;
  let match;
  while ((match = schemaPattern.exec(content)) !== null) {
    const fieldName = match[1] || match[2];
    if (fieldName && !features.schemaFields.includes(fieldName)) {
      features.schemaFields.push(fieldName);
    }
  }
  
  // 提取 imports
  const importMatch = content.match(/import\s*\(([\s\S]*?)\)/);
  if (importMatch) {
    const importBlock = importMatch[1];
    const importLines = importBlock.match(/"[^"]+"/g) || [];
    features.imports = importLines.map(i => i.replace(/"/g, ''));
  }
  
  // 提取函数名
  const funcPattern = /func\s+(?:\([^)]+\)\s+)?([A-Z][a-zA-Z0-9_]*)\s*\(/g;
  while ((match = funcPattern.exec(content)) !== null) {
    if (!features.functions.includes(match[1])) {
      features.functions.push(match[1]);
    }
  }
  
  return features;
}

/**
 * 计算两个特征集的相似度
 */
function calculateSimilarity(features1, features2) {
  let score = 0;
  let maxScore = 0;
  
  // CRUD 模式匹配 (权重: 20)
  maxScore += 20;
  let crudMatch = 0;
  if (features1.hasCreate === features2.hasCreate) crudMatch++;
  if (features1.hasRead === features2.hasRead) crudMatch++;
  if (features1.hasUpdate === features2.hasUpdate) crudMatch++;
  if (features1.hasDelete === features2.hasDelete) crudMatch++;
  score += (crudMatch / 4) * 20;
  
  // Schema 字段重叠 (权重: 30)
  maxScore += 30;
  if (features1.schemaFields.length > 0 && features2.schemaFields.length > 0) {
    const commonFields = features1.schemaFields.filter(f => features2.schemaFields.includes(f));
    const totalFields = new Set([...features1.schemaFields, ...features2.schemaFields]).size;
    score += (commonFields.length / totalFields) * 30;
  }
  
  // Import 重叠 (权重: 20)
  maxScore += 20;
  if (features1.imports.length > 0 && features2.imports.length > 0) {
    const commonImports = features1.imports.filter(i => features2.imports.includes(i));
    const totalImports = new Set([...features1.imports, ...features2.imports]).size;
    score += (commonImports.length / totalImports) * 20;
  }
  
  // 函数名模式 (权重: 15)
  maxScore += 15;
  if (features1.functions.length > 0 && features2.functions.length > 0) {
    const commonFuncs = features1.functions.filter(f => features2.functions.includes(f));
    score += (commonFuncs.length / Math.max(features1.functions.length, features2.functions.length)) * 15;
  }
  
  // 资源类型相似性 (权重: 15)
  maxScore += 15;
  if (features1.resourceType && features2.resourceType) {
    // 检查是否在同一服务下
    const service1 = features1.resourceType.split('_')[0];
    const service2 = features2.resourceType.split('_')[0];
    if (service1 === service2) {
      score += 15;
    } else if (features1.resourceType.includes(service2) || features2.resourceType.includes(service1)) {
      score += 7;
    }
  }
  
  return score / maxScore;
}

/**
 * 分析两个文件的关键差异
 */
function analyzeKeyDifferences(features1, features2) {
  const differences = [];
  
  // CRUD 差异
  if (features1.hasCreate !== features2.hasCreate) {
    differences.push(`Create function: ${features1.hasCreate ? 'present' : 'absent'} vs ${features2.hasCreate ? 'present' : 'absent'}`);
  }
  if (features1.hasUpdate !== features2.hasUpdate) {
    differences.push(`Update function: ${features1.hasUpdate ? 'present' : 'absent'} vs ${features2.hasUpdate ? 'present' : 'absent'}`);
  }
  
  // Schema 字段差异
  const uniqueFields1 = features1.schemaFields.filter(f => !features2.schemaFields.includes(f));
  const uniqueFields2 = features2.schemaFields.filter(f => !features1.schemaFields.includes(f));
  
  if (uniqueFields1.length > 0) {
    differences.push(`Fields only in target: ${uniqueFields1.slice(0, 5).join(', ')}${uniqueFields1.length > 5 ? '...' : ''}`);
  }
  if (uniqueFields2.length > 0) {
    differences.push(`Fields only in similar: ${uniqueFields2.slice(0, 5).join(', ')}${uniqueFields2.length > 5 ? '...' : ''}`);
  }
  
  return differences;
}

/**
 * 递归获取目录下所有 Go 文件
 */
function getGoFiles(dir, scope = 'directory', baseDir = null) {
  const results = [];
  baseDir = baseDir || dir;
  
  if (!fs.existsSync(dir)) {
    return results;
  }
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // 根据 scope 决定是否递归
      if (scope === 'directory') {
        continue; // 只搜索当前目录
      } else if (scope === 'service') {
        // 搜索同级服务目录
        const relativePath = path.relative(baseDir, fullPath);
        if (relativePath.split(path.sep).length <= 2) {
          results.push(...getGoFiles(fullPath, scope, baseDir));
        }
      } else if (scope === 'repo') {
        // 排除 vendor 和测试目录
        if (!entry.name.startsWith('.') && 
            entry.name !== 'vendor' && 
            entry.name !== 'node_modules' &&
            !entry.name.endsWith('_test')) {
          results.push(...getGoFiles(fullPath, scope, baseDir));
        }
      }
    } else if (entry.isFile() && entry.name.endsWith('.go') && !entry.name.endsWith('_test.go')) {
      results.push(fullPath);
    }
  }
  
  return results;
}

/**
 * 查找相似实现
 */
async function findSimilarImplementations(args) {
  const { file_path, scope = 'directory', limit = 5 } = args;
  
  if (!fs.existsSync(file_path)) {
    throw new Error(`File not found: ${file_path}`);
  }
  
  // 读取目标文件并提取特征
  const targetContent = fs.readFileSync(file_path, 'utf8');
  const targetFeatures = extractGoFeatures(targetContent, file_path);
  
  // 确定搜索目录
  let searchDir;
  if (scope === 'directory') {
    searchDir = path.dirname(file_path);
  } else if (scope === 'service') {
    // 假设服务目录在 internal/services/ 下
    const parts = file_path.split(path.sep);
    const servicesIndex = parts.indexOf('services');
    if (servicesIndex !== -1) {
      searchDir = parts.slice(0, servicesIndex + 2).join(path.sep);
    } else {
      searchDir = path.dirname(path.dirname(file_path));
    }
  } else {
    // repo scope - 从 internal 或项目根目录开始
    const parts = file_path.split(path.sep);
    const internalIndex = parts.indexOf('internal');
    if (internalIndex !== -1) {
      searchDir = parts.slice(0, internalIndex + 1).join(path.sep);
    } else {
      searchDir = path.dirname(path.dirname(file_path));
    }
  }
  
  // 获取所有 Go 文件
  const goFiles = getGoFiles(searchDir, scope);
  
  // 计算相似度
  const similarities = [];
  
  for (const filePath of goFiles) {
    // 跳过目标文件本身
    if (filePath === file_path) continue;
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const features = extractGoFeatures(content, filePath);
      const similarity = calculateSimilarity(targetFeatures, features);
      
      if (similarity > 0.1) { // 过滤掉相似度太低的
        similarities.push({
          path: filePath,
          similarity_score: Math.round(similarity * 100) / 100,
          features,
        });
      }
    } catch (err) {
      // 忽略无法读取的文件
    }
  }
  
  // 按相似度排序
  similarities.sort((a, b) => b.similarity_score - a.similarity_score);
  
  // 取前 N 个结果
  const topResults = similarities.slice(0, limit);
  
  // 构建返回结果
  const result = {
    target_file: file_path,
    target_features: {
      resource_type: targetFeatures.resourceType,
      has_crud: {
        create: targetFeatures.hasCreate,
        read: targetFeatures.hasRead,
        update: targetFeatures.hasUpdate,
        delete: targetFeatures.hasDelete,
      },
      schema_fields_count: targetFeatures.schemaFields.length,
    },
    search_scope: scope,
    search_directory: searchDir,
    files_analyzed: goFiles.length,
    similar_files: topResults.map(item => ({
      path: item.path,
      similarity_score: item.similarity_score,
      summary: `${item.features.resourceType || 'Unknown'} resource with ${item.features.schemaFields.length} schema fields`,
      key_differences: analyzeKeyDifferences(targetFeatures, item.features),
    })),
    recommendation: topResults.length > 0 
      ? `Recommend referencing ${topResults[0].path} (similarity: ${Math.round(topResults[0].similarity_score * 100)}%)`
      : 'No similar implementations found',
  };
  
  return result;
}

// 创建 MCP Server
const server = new Server(
  {
    name: 'code-similarity-finder',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 注册工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'find_similar_implementations',
        description: `查找与目标文件相似的代码实现。

功能：
- 分析 Go 文件的结构特征（CRUD 函数、Schema 字段、imports）
- 在指定范围内搜索相似实现
- 返回相似度排名和关键差异分析

使用场景：
- Phase 1 研究：找到可参考的类似资源实现
- 理解项目中的代码模式
- 学习最佳实践

支持的文件类型：Go (.go)`,
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: '目标文件的绝对路径',
            },
            scope: {
              type: 'string',
              enum: ['directory', 'service', 'repo'],
              description: '搜索范围：directory（当前目录）、service（同一服务下）、repo（整个仓库）',
              default: 'directory',
            },
            limit: {
              type: 'number',
              description: '返回结果数量限制',
              default: 5,
            },
          },
          required: ['file_path'],
        },
      },
    ],
  };
});

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === 'find_similar_implementations') {
    try {
      const result = await findSimilarImplementations(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error finding similar implementations: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
  
  throw new Error(`Unknown tool: ${name}`);
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Code Similarity Finder MCP Server running on stdio');
}

main().catch(console.error);
