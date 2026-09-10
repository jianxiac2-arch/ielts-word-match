/**
 * Scene3D — Three.js 3D 连连看渲染层
 * 自由几何体（螺旋阶梯）反向生长：配对成功 → 卡片飞到位渐显
 * CanvasTexture 渲染文字贴图
 */
class Scene3D {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!window.THREE) {
            console.error('Scene3D: Three.js 未加载');
            return;
        }
        this.THREE = window.THREE;
        this.init();
        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    init() {
        const TH = this.THREE;
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width || 400;
        const h = rect.height || 450;

        // 场景
        this.scene = new TH.Scene();
        this.scene.background = new TH.Color(0xf7f3ff);

        // 相机
        this.camera = new TH.PerspectiveCamera(50, w / h, 0.1, 100);
        this.camera.position.set(0, 2, 14);
        this.camera.lookAt(0, 0, 0);

        // 渲染器
        this.renderer = new TH.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = false;

        // 灯光
        const ambient = new TH.AmbientLight(0xffffff, 0.85);
        this.scene.add(ambient);
        const dir = new TH.DirectionalLight(0xffffff, 0.6);
        dir.position.set(5, 10, 7);
        this.scene.add(dir);

        // 卡片组
        this.cardGroup = new TH.Group();
        this.scene.add(this.cardGroup);

        // 点击检测
        this.raycaster = new TH.Raycaster();
        this.pointer = new TH.Vector2();
        this.canvas.addEventListener('click', (e) => this.onClick(e));
        this.canvas.addEventListener('touchstart', (e) => this.onTouch(e), { passive: false });

        // 交互状态
        this.cards = [];           // 所有卡片 mesh + 元数据
        this.selected = null;       // 当前选中的卡片
        this.onPairClick = null;    // game.js 注入的配对回调

        // 窗口 resize
        window.addEventListener('resize', () => this.onResize());
    }

    onResize() {
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width || 400;
        const h = rect.height || 450;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    /**
     * CanvasTexture: 把文字画到 canvas 上当贴图
     */
    makeTextTexture(text, isMeaning = false) {
        const TH = this.THREE;
        const cv = document.createElement('canvas');
        cv.width = 256;
        cv.height = 256;
        const ctx = cv.getContext('2d');

        // 背景
        ctx.fillStyle = isMeaning ? '#d6bcfa' : '#9f7aea';
        ctx.fillRect(0, 0, 256, 256);

        // 边框
        ctx.strokeStyle = '#6b46c1';
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, 250, 250);

        // 文字
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${isMeaning ? 28 : 36}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;

        // 多行自动换行
        const words = text.split(' ');
        let lines = [];
        let cur = '';
        const maxW = 220;
        for (const w of words) {
            const test = cur ? cur + ' ' + w : w;
            if (ctx.measureText(test).width > maxW) {
                if (cur) lines.push(cur);
                cur = w;
            } else {
                cur = test;
            }
        }
        if (cur) lines.push(cur);

        const lineH = lines.length > 2 ? 22 : 30;
        const startY = 128 - ((lines.length - 1) * lineH) / 2;
        lines.forEach((ln, i) => {
            ctx.fillText(ln, 128, startY + i * lineH);
        });

        const tex = new TH.CanvasTexture(cv);
        tex.needsUpdate = true;
        return tex;
    }

    /**
     * 构建螺旋阶梯形状的位置数组
     * 5 圈 × 6 块 = 30 个目标位置
     */
    buildSpiralPositions() {
        const positions = [];
        const rings = 5;
        const perRing = 6;
        const cx = 0, cz = 0;

        for (let r = 0; r < rings; r++) {
            const radius = 1.8 + r * 0.6;   // 外圈更大
            const y = -1.8 + r * 0.9;       // 越往上越高
            for (let i = 0; i < perRing; i++) {
                const angle = (i / perRing) * Math.PI * 2 + r * 0.3; // 每圈错开
                positions.push(new this.THREE.Vector3(
                    cx + Math.cos(angle) * radius,
                    y,
                    cz + Math.sin(angle) * radius
                ));
            }
        }
        return positions;
    }

    /**
     * 根据词汇数组生成 30 张 3D 卡片
     * @param {Array} wordPairs [{ word, meaning }, ...] 长度 15
     */
    buildCards(wordPairs) {
        this.clear();
        const TH = this.THREE;
        const positions = this.buildSpiralPositions();
        const cardGeo = new TH.BoxGeometry(1.6, 0.3, 1.2);

        // 打乱位置（随机化卡片分布）
        const indices = positions.map((_, i) => i).sort(() => Math.random() - 0.5);
        let posIdx = 0;

        // 为每对词汇生成 word + meaning 两张卡
        const all = [];
        for (let p = 0; p < wordPairs.length; p++) {
            all.push({ pairId: p, type: 'word', text: wordPairs[p].word });
            all.push({ pairId: p, type: 'meaning', text: wordPairs[p].meaning });
        }
        // 打乱
        all.sort(() => Math.random() - 0.5);

        all.forEach(item => {
            const tex = this.makeTextTexture(item.text, item.type === 'meaning');
            const mat = new TH.MeshStandardMaterial({
                map: tex,
                transparent: true,
                opacity: 1,
                roughness: 0.7,
                metalness: 0.1
            });
            const mesh = new TH.Mesh(cardGeo, mat);

            // 目标位置（配对成功后飞到这里）
            const targetIdx = indices[posIdx++];
            const targetPos = positions[targetIdx].clone();

            // 初始位置：在目标附近小范围扰动（可见但还没"对齐"）
            const initPos = new TH.Vector3(
                targetPos.x + (Math.random() - 0.5) * 4,
                targetPos.y - 5 - Math.random() * 3,
                targetPos.z + (Math.random() - 0.5) * 4
            );
            mesh.position.copy(initPos);
            mesh.scale.set(1, 1, 1);

            // 初始有随机旋转，让形状散乱感更明显
            mesh.rotation.y = Math.random() * Math.PI * 2;

            mesh.userData = {
                pairId: item.pairId,
                type: item.type,
                text: item.text,
                targetPos: targetPos,
                state: 'loose'   // loose(散乱可见) → selected(高亮) → grown(对齐目标)
            };

            this.cardGroup.add(mesh);
            this.cards.push(mesh);
        });
    }

    /** 清空所有卡片 */
    clear() {
        this.cardGroup.clear();
        this.cards = [];
        this.selected = null;
    }

    /**
     * 配对成功动画：两张卡飞向目标位置 + scale 归 1 + 旋转归零 + 轻微放大高亮
     */
    pairSuccess(pairId) {
        this.cards.forEach(mesh => {
            if (mesh.userData.pairId === pairId && mesh.userData.state === 'loose') {
                mesh.userData.state = 'growing';
            } else if (mesh.userData.pairId === pairId && mesh.userData.state === 'selected') {
                mesh.userData.state = 'growing';
            }
        });
        this.selected = null;
    }

    /** 配对失败：取消 selected 高亮（回到 loose 状态） */
    pairFail() {
        if (this.selected) {
            this.selected.userData.state = 'loose';
            this.selected = null;
        }
    }

    onClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
        this._pick(x, y);
    }

    onTouch(e) {
        e.preventDefault();
        const t = e.touches[0];
        if (!t) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = (t.clientX - rect.left) * (this.canvas.width / rect.width);
        const y = (t.clientY - rect.top) * (this.canvas.height / rect.height);
        this._pick(x, y);
    }

    _pick(x, y) {
        const TH = this.THREE;
        // 转换到 NDC
        this.pointer.x = (x / this.canvas.width) * 2 - 1;
        this.pointer.y = -(y / this.canvas.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);

        // loose / selected / grown 三种状态都可以被点击（初始 loose 也能点）
        const liveCards = this.cards.filter(c =>
            c.userData.state === 'loose' ||
            c.userData.state === 'selected' ||
            c.userData.state === 'grown'
        );
        const hits = this.raycaster.intersectObjects(liveCards);
        if (hits.length === 0) return;

        const clicked = hits[0].object;
        if (clicked.userData.state === 'selected') return; // 点已选中的无反应

        // 如果已有选中，尝试配对
        if (this.selected) {
            if (this.onPairClick) this.onPairClick(this.selected, clicked);
        } else {
            // 第一次选中
            clicked.userData.state = 'selected';
            this.selected = clicked;
        }
    }

    /**
     * 每帧动画循环
     * loose:    散乱在场景中（可见，可点击），轻微自转 + 随机位置扰动
     * selected: 选中态：略放大 + 发光 + 固定位置（不再飘动）
     * growing:  配对成功后飞向目标位置 + 旋转归零 + 缩放稳定
     * grown:    已就位：目标位置静止 + 缓慢自转
     */
    animate() {
        if (!this.THREE) return;
        const clock = performance.now();
        this.cards.forEach(mesh => {
            const ud = mesh.userData;
            const mat = mesh.material;

            if (ud.state === 'loose') {
                // 散乱状态：轻微自转 + opacity=1 + emissive 为 0
                mat.opacity = 1;
                mat.emissiveIntensity = 0;
                mesh.rotation.y += 0.006;
                mesh.rotation.x = Math.sin(clock * 0.002 + mesh.position.x) * 0.15;
                mesh.scale.set(1, 1, 1);
            } else if (ud.state === 'growing') {
                // 飞向目标位置 + 旋转归零 + opacity=1
                mesh.position.lerp(ud.targetPos, 0.08);
                mesh.rotation.x = 0;
                mesh.rotation.y = 0;
                mesh.rotation.z = 0;
                mat.opacity = 1;
                // 稍微放大表示"正在归位"
                mesh.scale.set(1.05, 1.05, 1.05);
                // 到达目标附近时切换到 grown
                if (mesh.position.distanceTo(ud.targetPos) < 0.08) {
                    ud.state = 'grown';
                    mesh.scale.set(1, 1, 1);
                }
            } else if (ud.state === 'selected') {
                // 选中态：略放大 + 发光 + 停止飘动
                const s = 1.08 + Math.sin(clock * 0.006) * 0.04;
                mesh.scale.set(s, s, s);
                mat.opacity = 1;
                mat.emissive = new this.THREE.Color(0x6b46c1);
                mat.emissiveIntensity = 0.3;
                mesh.position.x = mesh.position.x; // 固定位置
                mesh.position.y = mesh.position.y;
            } else if (ud.state === 'grown') {
                // 已就位：缓慢自转（非常慢，不打扰识别）
                mesh.rotation.y += 0.002;
                mesh.position.copy(ud.targetPos);
                mesh.scale.set(1, 1, 1);
                mat.opacity = 1;
                mat.emissiveIntensity = 0;
            }
        });

        // 卡片组整体缓慢自转（3D 感）
        this.cardGroup.rotation.y += 0.001;

        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(this.animate);
    }

    /** 已消除的对数（grown + selected），用于通关检测 */
    getGrownCount() {
        return this.cards.filter(c =>
            c.userData.state === 'grown' || c.userData.state === 'selected'
        ).length;
    }
}

// 导出为全局
window.Scene3D = Scene3D;
