class IELTSGame {
    constructor() {
        this.words = [];
        this.cards = [];
        this.selectedCards = [];
        this.score = 0;
        this.time = 90; // 1分30秒
        this.timer = null;
        this.gameStarted = false;
        this.matchedPairs = 0;
        this.currentUser = null;
        this.users = this.loadUsers();
        this.currentLevel = 1;
        this.totalLevels = 10; // 假设总共有10个关卡
        this.currentWords = []; // 当前游戏使用的词汇
        this.selectedLetter = null; // 选中的字母
        this.paddedWordCount = 0; // 目标字母词不足时补充的随机词数量
        this.cardStyles = [
            { backgroundColor: '#f7f3ff', borderColor: '#9f7aea' }, // 莫兰迪紫
            { backgroundColor: '#f5f0f6', borderColor: '#8b5cf6' }, // 莫兰迪深紫
            { backgroundColor: '#f3f4f6', borderColor: '#6b7280' }, // 莫兰迪灰
            { backgroundColor: '#fef3c7', borderColor: '#fbbf24' }, // 莫兰迪橙
            { backgroundColor: '#e6fffa', borderColor: '#38b2ac' }, // 莫兰迪绿
            { backgroundColor: '#ebf8ff', borderColor: '#4299e1' }  // 莫兰迪蓝
        ];
        this.currentCardColor = null;
        this.gridLayouts = [
            { columns: 6, rows: 5 },
            { columns: 5, rows: 6 },
            { columns: 4, rows: 8 } // 4x8布局，适应不同屏幕
        ];
        this.currentLayout = 0;
        
        this.init();
    }
    
    async init() {
        await this.loadWords();
        this.setupEventListeners();
        this.generateLetterSelection();
        this.initUserGate();
    }
    
    async loadWords() {
        // 优先使用 <script src="data/ielts_words.js"> 方式加载的词表
        // 该方式在 file:// 协议（双击打开HTML）下也能正常工作
        if (window.IELTS_WORDS && Array.isArray(window.IELTS_WORDS.words)) {
            this.words = window.IELTS_WORDS.words;
            return;
        }

        try {
            const response = await fetch('data/ielts_words.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            this.words = data.words;
        } catch (error) {
            console.error('Error loading words:', error);
            this.words = [];
        }
    }
    
    setupEventListeners() {
        document.getElementById('start-game-btn').addEventListener('click', () => this.startGame());
        document.getElementById('reset-btn').addEventListener('click', () => this.resetGame());
        document.getElementById('next-btn').addEventListener('click', () => this.nextLevel());
        document.getElementById('back-btn').addEventListener('click', () => this.goBackToLetterSelection());
        document.getElementById('user-name-confirm').addEventListener('click', () => this.confirmUserName());
        document.getElementById('user-name-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.confirmUserName();
        });
    }
    
    goBackToLetterSelection() {
        clearInterval(this.timer);
        this.gameStarted = false;
        
        // 切换回字母选择页面
        document.getElementById('game-page').classList.remove('active');
        document.getElementById('letter-selection-page').classList.add('active');
        
        // 重置选中的字母
        document.querySelectorAll('.letter').forEach(el => el.classList.remove('selected'));
        this.selectedLetter = null;
        
        document.getElementById('message').textContent = '';
    }
    
    generateLetterSelection() {
        const lettersContainer = document.getElementById('letters');
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        
        letters.split('').forEach(letter => {
            const letterElement = document.createElement('div');
            letterElement.className = 'letter';
            letterElement.textContent = letter;
            
            letterElement.addEventListener('click', () => {
                // 移除其他字母的选中状态
                document.querySelectorAll('.letter').forEach(el => el.classList.remove('selected'));
                // 添加当前字母的选中状态
                letterElement.classList.add('selected');
                // 保存选中的字母
                this.selectedLetter = letter.toLowerCase();
            });
            
            lettersContainer.appendChild(letterElement);
        });
    }
    
    loadUsers() {
        const usersJson = localStorage.getItem('ieltsGameUsers');
        return usersJson ? JSON.parse(usersJson) : [];
    }

    saveUsers() {
        // 最多保存3个用户
        if (this.users.length > 3) {
            this.users = this.users.slice(-3);
        }
        localStorage.setItem('ieltsGameUsers', JSON.stringify(this.users));
    }

    // 建档判定：有已保存的用户且档案存在 → 直接进入；否则展示建档遮罩
    initUserGate() {
        const savedName = localStorage.getItem('currentUser');
        const user = this.users.find(u => u.name === savedName);
        if (user) {
            this.activateUser(user);
        } else {
            if (savedName) localStorage.removeItem('currentUser');
            this.showUserGate();
        }
    }

    showUserGate() {
        const container = document.getElementById('existing-users');
        const subtitle = document.getElementById('gate-subtitle');
        const error = document.getElementById('gate-error');
        const input = document.getElementById('user-name-input');

        error.textContent = '';
        input.value = '';

        // 有历史档案：展示老用户快捷入口；否则只展示新建档输入框
        if (this.users.length > 0) {
            subtitle.textContent = '选择已有档案继续，或输入新名字建档';
            container.innerHTML = this.users
                .map(u => `<span class="existing-user-chip" data-name="${this.escapeHtml(u.name)}">${this.escapeHtml(u.name)}</span>`)
                .join('');
            container.querySelectorAll('.existing-user-chip').forEach(chip => {
                chip.addEventListener('click', () => this.confirmUserName(chip.dataset.name));
            });
        } else {
            subtitle.textContent = '输入你的名字，创建学习档案';
            container.innerHTML = '';
        }

        document.getElementById('user-gate').classList.add('active');
        setTimeout(() => input.focus(), 50);
    }

    hideUserGate() {
        document.getElementById('user-gate').classList.remove('active');
    }

    // 名字判定：命中已有档案 → 老用户继续；未命中 → 新用户建档
    confirmUserName(rawName) {
        const input = document.getElementById('user-name-input');
        const name = (typeof rawName === 'string' ? rawName : input.value).trim();
        const error = document.getElementById('gate-error');

        if (!name) {
            error.textContent = '名字不能为空';
            return;
        }

        let user = this.users.find(u => u.name === name);
        if (!user) {
            // 本地最多保留3个档案，超出时淘汰最早创建的档案
            const dropped = this.users.length >= 3 ? this.users[0] : null;
            if (this.users.length >= 3) this.users.shift();
            user = {
                name,
                totalMatchedWords: 0,
                levelsCompleted: 0,
                masteredWords: [],
                gameHistory: []
            };
            this.users.push(user);
            this.saveUsers();
            if (dropped) {
                error.textContent = `档案数量已达3个，最早的"${this.escapeHtml(dropped.name)}"档案已被替换`;
            }
        }

        localStorage.setItem('currentUser', name);
        this.activateUser(user);
    }

    activateUser(user) {
        this.currentUser = user;
        this.currentLevel = user.levelsCompleted + 1;
        this.hideUserGate();
        this.updateCurrentUserBar();
    }

    updateCurrentUserBar() {
        const bar = document.getElementById('current-user-bar');
        if (!bar) return;
        if (!this.currentUser) {
            bar.innerHTML = '';
            return;
        }
        bar.innerHTML = `当前用户：<b>${this.escapeHtml(this.currentUser.name)}</b><span class="switch-user" id="switch-user">切换用户</span>`;
        document.getElementById('switch-user').addEventListener('click', () => this.switchUser());
    }

    switchUser() {
        clearInterval(this.timer);
        this.gameStarted = false;
        this.selectedLetter = null;
        document.querySelectorAll('.letter').forEach(el => el.classList.remove('selected'));
        document.getElementById('game-page').classList.remove('active');
        document.getElementById('letter-selection-page').classList.add('active');
        this.showUserGate();
    }

    escapeHtml(str) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return String(str).replace(/[&<>"']/g, s => map[s]);
    }
    
    saveUserProgress() {
        const userIndex = this.users.findIndex(u => u.name === this.currentUser.name);
        if (userIndex !== -1) {
            this.users[userIndex] = this.currentUser;
            this.saveUsers();
        }
    }
    
    startGame() {
        // 切换到游戏页面
        document.getElementById('letter-selection-page').classList.remove('active');
        document.getElementById('game-page').classList.add('active');
        
        // 检查词表是否加载成功
        if (!Array.isArray(this.words) || this.words.length === 0) {
            document.getElementById('message').textContent = '词汇表数据加载失败，请确认 data/ielts_words.js 文件存在且未被移动。';
            return;
        }

        // 检查选中的字母是否有对应单词
        if (this.selectedLetter) {
            const filteredWords = this.words.filter(word => word.word.toLowerCase().startsWith(this.selectedLetter));
            if (filteredWords.length === 0) {
                document.getElementById('message').textContent = `词汇表中没有以"${this.selectedLetter.toUpperCase()}"开头的单词，请选择其他字母！`;
                return;
            }
        }
        
        this.gameStarted = true;
        this.score = 0;
        this.time = 90;
        this.selectedCards = [];
        this.matchedPairs = 0;
        
        // 随机切换布局，增加视觉多样性
        this.currentLayout = Math.floor(Math.random() * this.gridLayouts.length);
        
        // 随机选择一个卡片颜色，每轮游戏使用统一颜色
        this.currentCardColor = this.cardStyles[Math.floor(Math.random() * this.cardStyles.length)];
        
        // 生成新的词汇集
        this.generateWordSet();
        this.updateScore();
        this.updateTime();
        this.generateCards();
        this.startTimer();
        
        // 隐藏下一关卡按钮
        document.getElementById('next-btn').style.display = 'none';
        
        let message = `游戏开始！当前关卡：${this.currentLevel}`;
        if (this.selectedLetter) {
            message += `，练习以"${this.selectedLetter.toUpperCase()}"开头的单词`;
            if (this.paddedWordCount > 0) {
                message += `（${this.selectedLetter.toUpperCase()} 词仅 ${this.targetLetterWordCount} 个，已补充 ${this.paddedWordCount} 个随机词）`;
            }
        }
        document.getElementById('message').textContent = message;
    }
    
    resetGame() {
        clearInterval(this.timer);
        this.gameStarted = true;
        this.score = 0;
        this.time = 90;
        this.selectedCards = [];
        this.matchedPairs = 0;
        
        // 随机切换布局，增加视觉多样性
        this.currentLayout = Math.floor(Math.random() * this.gridLayouts.length);
        
        // 随机选择一个卡片颜色，每轮游戏使用统一颜色
        this.currentCardColor = this.cardStyles[Math.floor(Math.random() * this.cardStyles.length)];
        
        // 不重新抽词，只刷新词汇分布
        this.updateScore();
        this.updateTime();
        this.generateCards();
        this.startTimer();
        
        // 隐藏下一关卡按钮
        document.getElementById('next-btn').style.display = 'none';
        
        document.getElementById('message').textContent = '游戏已重置';
    }
    
    nextLevel() {
        // 隐藏下一关卡按钮
        document.getElementById('next-btn').style.display = 'none';
        // 开始新关卡
        this.startGame();
    }
    
    generateWordSet() {
        // 根据选中的字母过滤词汇
        let filteredWords = this.words;
        this.paddedWordCount = 0;
        this.targetLetterWordCount = 0;
        if (this.selectedLetter) {
            filteredWords = this.words.filter(word => word.word.toLowerCase().startsWith(this.selectedLetter));
            this.targetLetterWordCount = filteredWords.length;

            // 如果过滤后的词汇不足，添加随机词汇
            if (filteredWords.length < 15) {
                const need = 15 - filteredWords.length;
                this.paddedWordCount = need;
                const remainingWords = this.words.filter(word => !word.word.toLowerCase().startsWith(this.selectedLetter));
                const shuffledRemaining = [...remainingWords].sort(() => Math.random() - 0.5);
                filteredWords = [...filteredWords, ...shuffledRemaining.slice(0, need)];
            }
        }
        
        // 随机抽取15对词汇，尽量打乱
        const shuffledWords = [...filteredWords].sort(() => Math.random() - 0.5);
        
        // 混合老词和新词
        let selectedWords = [];
        const masteredWords = this.currentUser ? this.currentUser.masteredWords : [];
        
        // 确保包含一些已掌握的词和一些新的词
        const oldWords = shuffledWords.filter(word => masteredWords.includes(word.word)).slice(0, 5);
        const newWords = shuffledWords.filter(word => !masteredWords.includes(word.word)).slice(0, 10);
        selectedWords = [...oldWords, ...newWords];
        
        // 如果词汇不够，从剩余词汇中补充
        if (selectedWords.length < 15) {
            const remainingWords = shuffledWords.filter(word => !selectedWords.includes(word));
            selectedWords = [...selectedWords, ...remainingWords.slice(0, 15 - selectedWords.length)];
        }
        
        this.currentWords = selectedWords;
    }
    
    generateCards() {
        const container = document.getElementById('game-container');
        container.innerHTML = '';
        
        // 应用随机布局
        const layout = this.gridLayouts[this.currentLayout];
        container.style.gridTemplateColumns = `repeat(${layout.columns}, 1fr)`;
        
        // 生成词汇和释义对
        const cardPairs = [];
        this.currentWords.forEach(wordObj => {
            cardPairs.push({ content: wordObj.word, type: 'word', pairId: wordObj.word });
            cardPairs.push({ content: wordObj.meaning, type: 'meaning', pairId: wordObj.word });
        });
        
        // 打乱卡片顺序
        this.shuffleArray(cardPairs);
        
        // 创建卡片元素
        cardPairs.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = 'card';
            cardElement.dataset.pairId = card.pairId;
            cardElement.dataset.type = card.type;
            
            // 使用当前轮次的统一卡片颜色
            const cardStyle = this.currentCardColor;
            
            cardElement.innerHTML = `
                <div class="card-inner">
                    <div class="card-content" style="background-color: ${cardStyle.backgroundColor}; border-color: ${cardStyle.borderColor};">
                        ${card.content}
                    </div>
                </div>
            `;
            
            cardElement.addEventListener('click', () => this.selectCard(cardElement));
            container.appendChild(cardElement);
        });
    }
    
    selectCard(card) {
        if (!this.gameStarted) return;
        if (card.classList.contains('selected')) return;
        if (card.classList.contains('matched')) return;
        if (this.selectedCards.length >= 2) return;
        
        // 添加选中特效
        card.classList.add('selected');
        this.selectedCards.push(card);
        
        if (this.selectedCards.length === 2) {
            setTimeout(() => this.checkMatch(), 500);
        }
    }
    
    checkMatch() {
        const [card1, card2] = this.selectedCards;
        const pairId1 = card1.dataset.pairId;
        const pairId2 = card2.dataset.pairId;
        const type1 = card1.dataset.type;
        const type2 = card2.dataset.type;
        
        if (pairId1 === pairId2 && type1 !== type2) {
            // 匹配成功
            this.score += 10;
            this.matchedPairs++;
            this.updateScore();
            
            // 标记为匹配
            card1.classList.remove('selected');
            card2.classList.remove('selected');
            card1.classList.add('matched');
            card2.classList.add('matched');
            
            // 记录已掌握的词汇
            if (!this.currentUser.masteredWords.includes(pairId1)) {
                this.currentUser.masteredWords.push(pairId1);
            }
            
            // 检查游戏是否结束
            const remainingCards = document.querySelectorAll('.card:not(.matched)');
            if (remainingCards.length === 0) {
                this.endGame(true);
            }
        } else {
            // 匹配失败，移除选中状态
            card1.classList.remove('selected');
            card2.classList.remove('selected');
        }
        
        this.selectedCards = [];
    }
    
    startTimer() {
        this.timer = setInterval(() => {
            this.time--;
            this.updateTime();
            
            if (this.time <= 0) {
                this.endGame(false);
            }
        }, 1000);
    }
    
    endGame(won) {
        clearInterval(this.timer);
        this.gameStarted = false;
        
        // 更新用户记录
        this.currentUser.totalMatchedWords += this.matchedPairs;
        this.currentUser.gameHistory.push({
            date: new Date().toISOString(),
            score: this.score,
            matchedPairs: this.matchedPairs,
            level: this.currentLevel
        });
        
        let message = '';
        if (won) {
            // 检查是否达到通关标准
            if (this.matchedPairs >= 10) {
                // 通关成功
                this.currentUser.levelsCompleted++;
                this.currentLevel++;
                message = `恭喜你通过第${this.currentLevel - 1}关！得分：${this.score}，您已经掌握了${this.currentUser.totalMatchedWords}个词汇`;
                
                // 显示烟花特效
                this.showFireworks();
                
                // 显示下一关卡按钮
                document.getElementById('next-btn').style.display = 'inline-block';
                
                // 检查是否完全通关
                if (this.currentLevel > this.totalLevels) {
                    message += '\n恭喜你完全通关！';
                    this.currentLevel = 1; // 重置关卡
                }
            } else {
                // 未达到通关标准
                message = `时间到！得分：${this.score}，您已经掌握了${this.currentUser.totalMatchedWords}个词汇\n未达到通关标准（需要消除10对及以上词汇），请重新开始`;
            }
        } else {
            // 时间到
            message = `时间到！得分：${this.score}，您已经掌握了${this.currentUser.totalMatchedWords}个词汇`;
        }
        
        document.getElementById('message').textContent = message;
        this.saveUserProgress();
    }
    
    showFireworks() {
        // 简单的烟花特效实现
        const container = document.getElementById('game-container');
        
        for (let i = 0; i < 20; i++) {
            const firework = document.createElement('div');
            firework.style.position = 'absolute';
            firework.style.width = '10px';
            firework.style.height = '10px';
            firework.style.backgroundColor = this.getRandomColor();
            firework.style.borderRadius = '50%';
            firework.style.left = `${Math.random() * 100}%`;
            firework.style.top = `${Math.random() * 100}%`;
            firework.style.opacity = '1';
            firework.style.transition = 'all 1s ease-out';
            
            container.appendChild(firework);
            
            setTimeout(() => {
                firework.style.transform = `translate(${Math.random() * 200 - 100}px, ${Math.random() * 200 - 100}px)`;
                firework.style.opacity = '0';
                
                setTimeout(() => {
                    firework.remove();
                }, 1000);
            }, 100);
        }
    }
    
    getRandomColor() {
        const colors = ['#9f7aea', '#805ad5', '#6b46c1', '#4c1d95', '#2d1d69'];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    updateScore() {
        document.getElementById('score').textContent = this.score;
    }
    
    updateTime() {
        const totalTime = 90; // 总时间为90秒
        const percentage = this.time / totalTime;
        const circumference = 2 * Math.PI * 40; // 圆的周长
        const dashoffset = circumference * (1 - percentage);
        
        document.getElementById('time-progress').style.strokeDashoffset = dashoffset;
    }
    
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}

// 初始化游戏
window.addEventListener('DOMContentLoaded', () => {
    new IELTSGame();
});