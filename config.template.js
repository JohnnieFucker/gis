// 配置文件模板 - 复制此文件为 config.js 并填入实际配置
const CONFIG = {
    // 地图配置
    map: {
        center: [30.835, 104.417], // 默认中心点坐标 [纬度, 经度]
        zoom: 18, // 初始缩放级别
        minZoom: 17, // 最小缩放级别
        maxZoom: 18 // 最大缩放级别
    },

    // API配置
    api: {
        baseUrl: "https://your-api-domain.com/v1/draw/cg/points/data", // API基础地址
        customerId: "YOUR_CUSTOMER_ID", // 客户ID
        deviceIds: ["device_id_1", "device_id_2"] // 设备ID列表，可以添加多个设备ID
    },

    // GPS滤波参数（用于过滤GPS漂移）
    gpsFilter: {
        maxSpeed: 40, // 最大合理速度（km/h），厂区电瓶车通常不超过40km/h
        maxAcceleration: 3, // 最大加速度（m/s²），电瓶车加速相对较慢
        maxAngleChange: 120 // 最大角度变化（度），超过这个角度可能是漂移
    },

    // 轨迹滤波参数
    trajectoryFilter: {
        minDistance: 5 // 最小距离阈值（米），距离小于此值的点会被过滤
    },

    // 移动状态识别参数
    movementDetection: {
        windowSize: 3, // 滑动窗口大小（点数）
        stationaryDistanceThreshold: 10, // 静止距离阈值（米），30秒内位移小于此值视为静止
        movingDistanceThreshold: 20, // 移动距离阈值（米），30秒内位移超过此值视为移动
        minStateDuration: 90 // 最小状态持续时间（秒），用于平滑短暂变化
    },

    // 轨迹识别参数（用于识别完整的一趟）
    tripDetection: {
        minStationaryDuration: 60, // 最小静止时长（秒），至少静止此时间才算静止段
        minMovingDuration: 30 // 最小移动时长（秒），至少移动此时间才算移动段
    },

    // 停留标注参数
    stationaryLabel: {
        minStationaryDuration: 60 // 最小静止时长（秒），超过此时间的停留才标注
    }
};
