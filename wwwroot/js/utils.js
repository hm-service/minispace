// 特性配置：卡片内大图（expanded）中间态 —— 桌面大屏启用，移动端直开全屏
export const FEATURES = {
    expandedMode: true, // 总开关
    expandedMinWidth: 768, // 启用 expanded 的最小视口宽度（px）
};
export function expandedModeEnabled() {
    return (
        FEATURES.expandedMode &&
        window.matchMedia(`(min-width: ${FEATURES.expandedMinWidth}px)`).matches
    );
}

export function fmtTime(sec) {
    const d = new Date((sec || 0) * 1000);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
    if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + " 天前";
    const pad = (n) => String(n).padStart(2, "0");
    return (
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        " " +
        pad(d.getHours()) +
        ":" +
        pad(d.getMinutes())
    );
}

export function fullTime(sec) {
    const d = new Date((sec || 0) * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return (
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        " " +
        pad(d.getHours()) +
        ":" +
        pad(d.getMinutes()) +
        ":" +
        pad(d.getSeconds())
    );
}

export function avatarStyle(id) {
    let h = 0;
    const s = String(id || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const h1 = h % 360;
    const h2 = (h1 + 40 + ((h >>> 3) % 70)) % 360;
    return { background: `linear-gradient(135deg, hsl(${h1} 72% 62%), hsl(${h2} 66% 46%))` };
}
