/**
 * Scene3DLayered — 分层 3D 连连看（v7d 最小验证版）
 *
 * 设计原则（吸取 v7 教训）：
 * 1. 交互区（卡片墙）：平面卡片，正面朝相机，静止不转 → 文字清晰、点击精准
 * 2. 奖励区（形状塔）：配对成功后卡片飞到塔上拼块，提供"形状在生长"的成就感
 * 3. 桌面横屏：左墙右塔；手机竖屏：上墙下塔
 *
 * 状态机：idle → selected → flying → settled
 *                  └→ shake(配对失败) → idle
 */
class Scene3DLayered {
    constructor(containerId) {
        const container = document.getElementById(containerId);
        if (!container || !window.THREE) {
            console.error('Scene3DLayered: 容器或 Three.js 缺失');
            return;
        }
        this.THREE = window.THREE;
        this.container = container;

        // 动态建 canvas（2D 模式下容器内仍是 DOM 卡片）
        container.innerHTML = '';
        container.style.display = 'block';
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'game-canvas-3d';
        this.canvas.style.cssText = 'width:100%;height:100%;display:block;';
        container.appendChild(this.canvas);

        this.onPairClick = null;
        this.cards = [];
        this.ghosts = [];
        this.selected = null;

        this.initScene();
        this.bindEvents();
        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    initScene() {
        const TH = this.THREE;
        const w = this.container.clientWidth || 400;
        const h = this.container.clientHeight || 450;
        this.aspect = w / h;
        this.portrait = this.aspect < 0.9;

        this.scene = new TH.Scene();
        this.scene.background = new TH.Color(0xf7f3ff);

        this.camera = new TH.PerspectiveCamera(40, this.aspect, 0.1, 100);
        this.camera.position.set(0, 0, 13);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new TH.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(w, h, false); // false：不写内联 px，保持 CSS 100%
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.scene.add(new TH.AmbientLight(0xffffff, 1.0));
        const dl = new TH.DirectionalLight(0xffffff, 0.4);
        dl.position.set(4, 6, 8);
        this.scene.add(dl);

        this.wallGroup = new TH.Group();
        this.towerGroup = new TH.Group();
        this.scene.add(this.wallGroup, this.towerGroup);

        // 区域中心（横屏左右 / 竖屏上下）
        this.wallCenter = this.portrait ? new TH.Vector3(0, 2.6, 0) : new TH.Vector3(-3.4, 0, 0);
        this.towerCenter = this.portrait ? new TH.Vector3(0, -2.7, 0) : new TH.Vector3(3.7, 0, 0);

        this.buildTowerBase();

        this.raycaster = new TH.Raycaster();
        this.pointer = new TH.Vector2();
    }

    /** 塔底座 + 中心杆（暗示"塔会向上生长"）*/
    buildTowerBase() {
        const TH = this.THREE;
        const base = new TH.Mesh(
            new TH.CylinderGeometry(1.7, 1.9, 0.18, 40),
            new TH.MeshStandardMaterial({ color: 0xe9d8fd, roughness: 0.9 })
        );
        base.position.set(this.towerCenter.x, this.towerCenter.y - 1.35, 0);
        this.towerGroup.add(base);

        const pole = new TH.Mesh(
            new TH.CylinderGeometry(0.035, 0.035, 2.6, 12),
            new TH.MeshBasicMaterial({ color: 0xd6bcfa })
        );
        pole.position.set(this.towerCenter.x, this.towerCenter.y, -0.1);
        this.towerGroup.add(pole);
    }

    /** CanvasTexture：白底紫边紫字，与 2D 卡视觉一致 */
    makeTextTexture(text, isMeaning) {
        const cv = document.createElement('canvas');
        cv.width = 384;
        cv.height = 240;
        const ctx = cv.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 384, 240);
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#9f7aea';
        ctx.strokeRect(5, 5, 374, 230);

        ctx.fillStyle = '#553c9a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${isMeaning ? 38 : 44}px Arial, "Microsoft YaHei", sans-serif`;

        // 英文按空格换行；中文按字数切
        let lines;
        if (isMeaning && /[\u4e00-\u9fa5]/.test(text)) {
            lines = text.length > 6 ? [text.slice(0, 6), text.slice(6, 12)] : [text];
        } else {
            const words = text.split(' ');
            lines = [];
            let cur = '';
            for (const wd of words) {
                const test = cur ? cur + ' ' + wd : wd;
                if (ctx.measureText(test).width > 320 && cur) { lines.push(cur); cur = wd; }
                else cur = test;
            }
            if (cur) lines.push(cur);
            lines = lines.slice(0, 2);
        }

        const lh = 52;
        const y0 = 120 - ((lines.length - 1) * lh) / 2;
        lines.forEach((ln, i) => ctx.fillText(ln, 192, y0 + i * lh));

        const tex = new this.THREE.CanvasTexture(cv);
        tex.anisotropy = 4;
        return tex;
    }

    /** 墙上卡片的网格位置（3 对=6 张 → 3列2行）*/
    wallSlot(index, cols, rows) {
        const gapX = this.portrait ? 2.05 : 2.0;
        const gapY = 1.35;
        const col = index % cols;
        const row = Math.floor(index / cols);
        return new this.THREE.Vector3(
            this.wallCenter.x + (col - (cols - 1) / 2) * gapX,
            this.wallCenter.y + ((rows - 1) / 2 - row) * gapY,
            0
        );
    }

    /** 塔上的目标位置（螺旋塔：5层×6块），返回第 n 块的坐标 */
    towerSlot(n) {
        const perRing = 6;
        const ring = Math.floor(n / perRing);
        const i = n % perRing;
        const radius = this.portrait ? 0.95 : 1.15;
        const angle = (i / perRing) * Math.PI * 2 + ring * 0.45;
        return new this.THREE.Vector3(
            this.towerCenter.x + Math.cos(angle) * radius,
            this.towerCenter.y - 0.9 + ring * 0.72 + i * 0.0,
            -0.15 - Math.sin(angle) * 0.35
        );
    }

    buildCards(wordPairs) {
        this.clear();
        const TH = this.THREE;

        // 生成 word/meaning 卡并打乱
        const items = [];
        wordPairs.forEach((p, idx) => {
            items.push({ pairId: idx, type: 'word', text: p.word });
            items.push({ pairId: idx, type: 'meaning', text: p.meaning });
        });
        items.sort(() => Math.random() - 0.5);

        const cols = 3;
        const rows = 2;
        const cardW = 1.85, cardH = 1.18;
        const cardGeo = new TH.PlaneGeometry(cardW, cardH);
        const haloGeo = new TH.PlaneGeometry(cardW + 0.18, cardH + 0.18);

        items.forEach((item, index) => {
            const group = new TH.Group();
            const slot = this.wallSlot(index, cols, rows);
            group.position.copy(slot);

            // 黄色选中光环（平时隐藏）
            const halo = new TH.Mesh(
                haloGeo,
                new TH.MeshBasicMaterial({ color: 0xfbbf24 })
            );
            halo.position.z = -0.02;
            halo.visible = false;

            const mat = new TH.MeshStandardMaterial({
                map: this.makeTextTexture(item.text, item.type === 'meaning'),
                roughness: 0.85,
                metalness: 0,
                side: TH.FrontSide
            });
            const face = new TH.Mesh(cardGeo, mat);

            group.add(halo, face);
            this.wallGroup.add(group);

            // 对应的塔位 + 幽灵块
            const target = this.towerSlot(this.cards.length);
            const ghost = new TH.Mesh(
                new TH.BoxGeometry(1.0, 0.62, 0.1),
                new TH.MeshBasicMaterial({ color: 0x9f7aea, transparent: true, opacity: 0.1 })
            );
            ghost.position.copy(target);
            this.towerGroup.add(ghost);
            this.ghosts.push(ghost);

            group.userData = {
                pairId: item.pairId,
                type: item.type,
                text: item.text,
                face, halo, mat,
                homePos: slot.clone(),
                targetPos: target,
                ghost,
                state: 'idle',
                failUntil: 0
            };
            this.cards.push(group);
        });

        this.syncSize();
        this.scene.updateMatrixWorld(true);
    }

    clear() {
        this.wallGroup.clear();
        this.towerGroup.clear();
        this.cards = [];
        this.ghosts = [];
        this.selected = null;
        this.buildTowerBase();
    }

    pairSuccess(pairId) {
        this.cards.forEach(c => {
            if (c.userData.pairId === pairId &&
                (c.userData.state === 'selected' || c.userData.state === 'idle')) {
                c.userData.state = 'flying';
                c.userData.halo.visible = false;
            }
        });
        this.selected = null;
    }

    pairFail() {
        const now = performance.now();
        if (this.selected) {
            this.selected.userData.state = 'shake';
            this.selected.userData.failUntil = now + 350;
            this.selected.userData.halo.visible = false;
        }
        // 另一张（刚点的非匹配卡）也抖一下
        if (this._lastClicked && this._lastClicked !== this.selected) {
            this._lastClicked.userData.state = 'shake';
            this._lastClicked.userData.failUntil = now + 350;
        }
        this.selected = null;
        this._lastClicked = null;
    }

    bindEvents() {
        const toNDC = (clientX, clientY) => {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: ((clientX - rect.left) / rect.width) * 2 - 1,
                y: -((clientY - rect.top) / rect.height) * 2 + 1
            };
        };

        this.canvas.addEventListener('click', e => {
            // 触摸后浏览器会合成 click，抑制掉避免同一次点按触发两次
            if (this._touchFired) { this._touchFired = false; return; }
            const p = toNDC(e.clientX, e.clientY);
            this.pick(p.x, p.y);
        });
        this.canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            this._touchFired = true;
            setTimeout(() => { this._touchFired = false; }, 500);
            const t = e.touches[0];
            const p = toNDC(t.clientX, t.clientY);
            this.pick(p.x, p.y);
        }, { passive: false });

        window.addEventListener('resize', () => this.syncSize());

        // 容器尺寸变化（页面切换动画/视口变化）时自动校正相机与渲染缓冲
        if (window.ResizeObserver) {
            this._ro = new ResizeObserver(() => this.syncSize());
            this._ro.observe(this.container);
        }
        // 首帧再校正一次，兜住初始化时容器尚在过渡中的情况
        requestAnimationFrame(() => this.syncSize());
    }

    syncSize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (!w || !h) return;
        this.aspect = w / h;
        this.camera.aspect = this.aspect;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
    }

    pick(nx, ny) {
        // 不依赖渲染循环：射线检测前强制同步世界矩阵
        // （后台标签 rAF 被系统冻结时点击仍然精准）
        this.scene.updateMatrixWorld(true);
        this.pointer.set(nx, ny);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const live = this.cards.filter(c => c.userData.state === 'idle' || c.userData.state === 'selected');
        const hits = this.raycaster.intersectObjects(live.map(c => c.userData.face), false);
        if (!hits.length) return;

        const clicked = hits[0].object.parent; // Group
        if (clicked.userData.state === 'selected') return;
        if (clicked.userData.state !== 'idle') return;

        if (this.selected) {
            this._lastClicked = clicked;
            this.onPairClick && this.onPairClick(this.selected, clicked);
        } else {
            clicked.userData.state = 'selected';
            clicked.userData.halo.visible = true;
            this.selected = clicked;
        }
    }

    animate() {
        if (!this.THREE) return;
        const now = performance.now();

        // 兜底：容器尺寸变化而 RO 未触发时，每帧自检
        const cw = this.container.clientWidth, ch = this.container.clientHeight;
        if (cw && ch && (cw !== this._lastCW || ch !== this._lastCH)) {
            this._lastCW = cw; this._lastCH = ch;
            this.syncSize();
        }

        this.cards.forEach(c => {
            const ud = c.userData;
            if (ud.state === 'idle') {
                c.position.copy(ud.homePos);
                c.scale.set(1, 1, 1);
                ud.mat.emissive.setHex(0x000000);
            } else if (ud.state === 'selected') {
                c.position.set(ud.homePos.x, ud.homePos.y + 0.12, ud.homePos.z);
                const s = 1.06 + Math.sin(now * 0.006) * 0.015;
                c.scale.set(s, s, 1);
                ud.mat.emissive.setHex(0x553c9a);
                ud.mat.emissiveIntensity = 0.35;
            } else if (ud.state === 'shake') {
                const t = (ud.failUntil - now) / 350;
                if (now > ud.failUntil) {
                    ud.state = 'idle';
                    c.position.copy(ud.homePos);
                    ud.mat.emissive.setHex(0x000000);
                } else {
                    c.position.x = ud.homePos.x + Math.sin(now * 0.05) * 0.12 * t;
                    ud.mat.emissive.setHex(0xe53e3e);
                    ud.mat.emissiveIntensity = 0.4 * t;
                }
            } else if (ud.state === 'flying') {
                c.position.lerp(ud.targetPos, 0.12);
                c.scale.lerp(new this.THREE.Vector3(0.52, 0.52, 1), 0.12);
                if (c.position.distanceTo(ud.targetPos) < 0.08) {
                    c.position.copy(ud.targetPos);
                    c.scale.set(0.52, 0.52, 1);
                    ud.state = 'settled';
                    ud.ghost.visible = false;
                    ud.mat.emissive.setHex(0x9f7aea);
                    ud.mat.emissiveIntensity = 0.18;
                }
            } else if (ud.state === 'settled') {
                ud.mat.emissiveIntensity = 0.15 + Math.sin(now * 0.003 + ud.pairId) * 0.05;
            }
        });

        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(this.animate);
    }

    get settledCount() {
        return this.cards.filter(c => c.userData.state === 'settled').length;
    }
}

window.Scene3DLayered = Scene3DLayered;
