// 解析用户提供的雅思词汇表JSON文件
const fs = require('fs');
const path = require('path');

// 读取用户提供的JSON文件
const userJsonPath = path.join(__dirname, '../../雅思词汇表8000词.json');
const gameJsonPath = path.join(__dirname, '../data/ielts_words.js');

try {
    // 读取文件内容
    const userJsonContent = fs.readFileSync(userJsonPath, 'utf8');

    // 解析JSON
    const userData = JSON.parse(userJsonContent);

    // 读取游戏词库（浏览器端通过 <script> 加载的 JS 文件）
    let gameData = { words: [] };
    if (fs.existsSync(gameJsonPath)) {
        const gameJsContent = fs.readFileSync(gameJsonPath, 'utf8');
        // 从 "window.IELTS_WORDS = {...};" 中提取 JSON 部分
        const gameJsonText = gameJsContent
            .replace(/^\s*window\.IELTS_WORDS\s*=\s*/, '')
            .replace(/;\s*$/, '');
        gameData = JSON.parse(gameJsonText);
    }
    
    // 提取词汇
    const extractedWords = [];
    
    userData.pages.forEach(page => {
        const text = page.text;
        // 提取词汇和释义
        // 注意：这里的解析可能需要根据实际格式调整
        const words = text.split(/\s+/).filter(word => word.length > 0);
        
        for (let i = 0; i < words.length; i++) {
            let word = words[i];
            // 跳过非词汇项
            if (word === '雅思词汇表' || word === 'n.' || word === 'v.' || word === 'adj.' || word === 'adv.') {
                continue;
            }
            
            // 简单处理，假设每个词汇后面跟着释义
            // 这里只是一个简单的实现，实际需要更复杂的解析
            let meaning = '暂无释义';
            if (i + 1 < words.length && !words[i + 1].match(/^[a-zA-Z]+$/)) {
                meaning = words[i + 1];
                i++;
            }
            
            extractedWords.push({ word, meaning });
        }
    });
    
    // 去重
    const uniqueWords = [];
    const seenWords = new Set();
    
    extractedWords.forEach(item => {
        if (!seenWords.has(item.word)) {
            seenWords.add(item.word);
            uniqueWords.push(item);
        }
    });
    
    // 合并到游戏词汇库
    const mergedWords = [...gameData.words, ...uniqueWords];
    
    // 保存到游戏词汇库（包装为浏览器可直接 <script> 加载的格式）
    const updatedGameData = { words: mergedWords };
    const jsContent = 'window.IELTS_WORDS = ' + JSON.stringify(updatedGameData, null, 2) + ';\n';
    fs.writeFileSync(gameJsonPath, jsContent, 'utf8');
    
    console.log(`成功添加 ${uniqueWords.length} 个词汇到游戏词汇库`);
    console.log(`游戏词汇库现在共有 ${mergedWords.length} 个词汇`);
    
} catch (error) {
    console.error('解析词汇表时出错:', error);
}