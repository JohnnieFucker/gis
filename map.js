// 地图配置脚本已加载
console.log("map.js 文件已加载");

// 使用配置文件中的地图配置
const MAP_CONFIG = CONFIG.map;

// 车辆数据和地图相关变量
let vehicles = [];
let vehicleMarkers = {};
let vehicleTrajectoryLayers = {};
let markerLayerGroup = null;
let trajectoryLayerGroup = null;
let map = null;
let selectedVehicleId = null;
// 不再需要轨迹类型选择
let refreshInterval = null; // 定时刷新间隔ID

// WGS84 转 GCJ-02 (火星坐标系) 算法
const CoordTransform = {
    PI: 3.1415926535897932384626,
    a: 6378245.0,
    ee: 0.00669342162296594323,

    transformlat: function (lng, lat) {
        let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
        ret += ((20.0 * Math.sin(6.0 * lng * this.PI) + 20.0 * Math.sin(2.0 * lng * this.PI)) * 2.0) / 3.0;
        ret += ((20.0 * Math.sin(lat * this.PI) + 40.0 * Math.sin((lat / 3.0) * this.PI)) * 2.0) / 3.0;
        ret += ((160.0 * Math.sin((lat / 12.0) * this.PI) + 320 * Math.sin((lat * this.PI) / 30.0)) * 2.0) / 3.0;
        return ret;
    },

    transformlng: function (lng, lat) {
        let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
        ret += ((20.0 * Math.sin(6.0 * lng * this.PI) + 20.0 * Math.sin(2.0 * lng * this.PI)) * 2.0) / 3.0;
        ret += ((20.0 * Math.sin(lng * this.PI) + 40.0 * Math.sin((lng / 3.0) * this.PI)) * 2.0) / 3.0;
        ret += ((150.0 * Math.sin((lng / 12.0) * this.PI) + 300.0 * Math.sin((lng / 30.0) * this.PI)) * 2.0) / 3.0;
        return ret;
    },

    wgs84togcj02: function (lng, lat) {
        lat = parseFloat(lat);
        lng = parseFloat(lng);
        let dlat = this.transformlat(lng - 105.0, lat - 35.0);
        let dlng = this.transformlng(lng - 105.0, lat - 35.0);
        let radlat = (lat / 180.0) * this.PI;
        let magic = Math.sin(radlat);
        magic = 1 - this.ee * magic * magic;
        let sqrtmagic = Math.sqrt(magic);
        dlat = (dlat * 180.0) / (((this.a * (1 - this.ee)) / (magic * sqrtmagic)) * this.PI);
        dlng = (dlng * 180.0) / ((this.a / sqrtmagic) * Math.cos(radlat) * this.PI);
        let mglat = lat + dlat;
        let mglng = lng + dlng;
        return [mglng, mglat];
    }
};

// 创建自定义的高德瓦片图层类
const GaodeTileLayer = L.TileLayer.extend({
    getTileUrl: function (coords) {
        const x = coords.x;
        const y = coords.y;
        const z = coords.z;
        return `https://webst01.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}`;
    }
});

function gaodeTileLayer(options) {
    return new GaodeTileLayer("", options);
}

// 初始化地图
function initMap() {
    map = L.map("map", {
        center: MAP_CONFIG.center,
        zoom: MAP_CONFIG.zoom,
        minZoom: MAP_CONFIG.minZoom,
        maxZoom: MAP_CONFIG.maxZoom
    });

    // 添加高德地图图层
    gaodeTileLayer({
        attribution: '&copy; <a href="https://www.amap.com/">高德地图</a>',
        maxZoom: MAP_CONFIG.maxZoom,
        minZoom: MAP_CONFIG.minZoom,
        tileSize: 256
    }).addTo(map);

    // 创建车辆标注图层组
    markerLayerGroup = L.layerGroup().addTo(map);

    // 创建轨迹线图层组
    trajectoryLayerGroup = L.layerGroup().addTo(map);
}

// 使用配置文件中的API配置
const API_CONFIG = CONFIG.api;

// 从API获取车辆位置数据
async function fetchVehicleData(deviceId) {
    try {
        const url = `${API_CONFIG.baseUrl}?customer_id=${API_CONFIG.customerId}&device_id=${deviceId}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.c === 200 && data.d && data.d.length > 0) {
            return data.d[0]; // 返回第一条数据
        }

        return null;
    } catch (error) {
        console.error(`获取车辆 ${deviceId} 数据失败:`, error);
        return null;
    }
}

// 获取所有车辆数据
async function fetchAllVehicles() {
    const vehiclePromises = API_CONFIG.deviceIds.map((deviceId) => fetchVehicleData(deviceId));
    const results = await Promise.all(vehiclePromises);

    vehicles = results
        .filter((result) => result !== null)
        .map((result) => {
            const updateTime = new Date(result.time);

            return {
                id: result.device_id,
                name: result.device_name,
                currentLocation: {
                    lat: CoordTransform.wgs84togcj02(result.realtime_datas.longitude, result.realtime_datas.latitude)[1],
                    lng: CoordTransform.wgs84togcj02(result.realtime_datas.longitude, result.realtime_datas.latitude)[0]
                },
                lastUpdateTime: updateTime
            };
        });

    // 显示所有车辆位置
    displayAllVehicles();

    // 更新车辆列表UI
    updateVehicleList();

    // 如果有选中的车辆，自动更新其轨迹
    if (selectedVehicleId) {
        console.log(`自动更新选中车辆 ${selectedVehicleId} 的轨迹`);
        await displayVehicleTrajectory(selectedVehicleId);
    }
}

// 加载车辆数据（初始加载）
async function loadVehicles() {
    console.log("开始加载车辆数据...");
    await fetchAllVehicles();
    console.log("车辆数据加载完成");
}

// 计算两点之间的距离（米）
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // 地球半径（米）
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// GPS漂移滤波：基于速度、距离和角度的综合滤波
function filterGPSDrift(points) {
    if (points.length <= 2) return points;

    // 使用配置文件中的GPS滤波参数
    const MAX_SPEED = CONFIG.gpsFilter.maxSpeed;
    const MAX_ACCELERATION = CONFIG.gpsFilter.maxAcceleration;
    const MAX_ANGLE_CHANGE = CONFIG.gpsFilter.maxAngleChange;

    const filtered = [points[0]]; // 保留第一个点

    for (let i = 1; i < points.length; i++) {
        const prevPoint = filtered[filtered.length - 1];
        const currentPoint = points[i];
        const distance = calculateDistance(prevPoint.lat, prevPoint.lng, currentPoint.lat, currentPoint.lng);
        console.log("distance", distance);

        // 计算时间差（秒）
        const timeDiff = (currentPoint.time - prevPoint.time) / 1000;
        if (timeDiff <= 0) continue; // 跳过时间无效的点

        // 计算速度（m/s转换为km/h）
        const speed = (distance / timeDiff) * 3.6; // m/s to km/h

        // 检查速度是否合理
        if (speed > MAX_SPEED) {
            console.log(`过滤漂移点: 速度 ${speed.toFixed(2)} km/h 超过最大值 ${MAX_SPEED} km/h`);
            continue; // 速度过快，可能是漂移，跳过该点
        }

        // 如果距离太小（小于1米），可能是GPS抖动，检查是否需要保留
        if (distance < 1 && i < points.length - 1) {
            // 如果下一点距离当前点很远，说明当前点可能是漂移
            const nextPoint = points[i + 1];
            const nextDistance = calculateDistance(currentPoint.lat, currentPoint.lng, nextPoint.lat, nextPoint.lng);
            const nextTimeDiff = (nextPoint.time - currentPoint.time) / 1000;
            if (nextTimeDiff > 0) {
                const nextSpeed = (nextDistance / nextTimeDiff) * 3.6;
                if (nextSpeed > MAX_SPEED) {
                    console.log(`过滤漂移点: 下一点速度异常 ${nextSpeed.toFixed(2)} km/h`);
                    continue;
                }
            }
        }

        // 检查角度变化（如果有前一个点）
        if (filtered.length >= 2) {
            const prevPrevPoint = filtered[filtered.length - 2];
            const angle1 = calculateBearing(prevPrevPoint.lat, prevPrevPoint.lng, prevPoint.lat, prevPoint.lng);
            const angle2 = calculateBearing(prevPoint.lat, prevPoint.lng, currentPoint.lat, currentPoint.lng);

            // 计算角度变化（考虑360度循环）
            let angleChange = Math.abs(angle2 - angle1);
            if (angleChange > 180) {
                angleChange = 360 - angleChange;
            }

            // 如果角度变化太大且速度较高，可能是漂移
            // 对于货车，在高速行驶时（>60km/h）角度变化应该更平滑，低速时允许更大的角度变化
            const speedThreshold = speed > 60 ? 60 : 30; // 高速时更严格，低速时允许更大角度变化
            if (angleChange > MAX_ANGLE_CHANGE && speed > speedThreshold) {
                console.log(`过滤漂移点: 角度变化 ${angleChange.toFixed(2)}度 超过最大值 ${MAX_ANGLE_CHANGE}度，速度 ${speed.toFixed(2)} km/h`);
                continue;
            }
        }

        // 检查加速度（如果有前一个点）
        if (filtered.length >= 1 && timeDiff > 0) {
            const prevSpeed = filtered.length >= 2 ? (calculateDistance(filtered[filtered.length - 2].lat, filtered[filtered.length - 2].lng, prevPoint.lat, prevPoint.lng) / ((prevPoint.time - filtered[filtered.length - 2].time) / 1000)) * 3.6 : 0;

            if (prevSpeed > 0) {
                const acceleration = Math.abs((speed - prevSpeed) / 3.6) / timeDiff; // m/s²
                if (acceleration > MAX_ACCELERATION) {
                    console.log(`过滤漂移点: 加速度 ${acceleration.toFixed(2)} m/s² 超过最大值 ${MAX_ACCELERATION} m/s²`);
                    continue;
                }
            }
        }

        // 通过所有检查，保留该点
        filtered.push(currentPoint);
    }

    // 确保保留最后一个点
    if (filtered[filtered.length - 1].time !== points[points.length - 1].time) {
        filtered.push(points[points.length - 1]);
    }

    return filtered;
}

// 使用滑动窗口分析移动状态（通用函数）
function analyzeMovementStatesForTrips(points) {
    if (points.length < 3) return [];

    // 使用配置文件中的移动状态识别参数
    const WINDOW_SIZE = CONFIG.movementDetection.windowSize;
    const STATIONARY_DISTANCE_THRESHOLD = CONFIG.movementDetection.stationaryDistanceThreshold;
    const MOVING_DISTANCE_THRESHOLD = CONFIG.movementDetection.movingDistanceThreshold;
    const MIN_STATE_DURATION_SECONDS = CONFIG.movementDetection.minStateDuration;

    // 计算每个点的状态（使用滑动窗口判断）
    const states = []; // 'stationary', 'moving'

    // 先计算相邻点之间的距离
    const distances = [];
    for (let i = 1; i < points.length; i++) {
        const dist = calculateDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
        const timeDiff = (points[i].time - points[i - 1].time) / 1000; // 秒
        distances.push({ dist, timeDiff, index: i });
    }

    // 使用滑动窗口和状态机识别持续的状态
    let currentState = null;
    let stateStartIndex = 0;
    let stateStartTime = points[0].time;
    let consecutiveSameState = 0; // 连续相同状态的次数

    for (let i = 0; i < distances.length; i++) {
        // 使用滑动窗口计算平均距离
        let windowStart = Math.max(0, i - Math.floor(WINDOW_SIZE / 2));
        let windowEnd = Math.min(distances.length - 1, i + Math.floor(WINDOW_SIZE / 2));

        let totalDist = 0;
        let totalTime = 0;
        for (let j = windowStart; j <= windowEnd; j++) {
            totalDist += distances[j].dist;
            totalTime += distances[j].timeDiff;
        }

        const avgDistance = windowEnd >= windowStart ? totalDist / (windowEnd - windowStart + 1) : 0;

        // 判断当前状态
        let newState;
        if (avgDistance < STATIONARY_DISTANCE_THRESHOLD) {
            newState = "stationary";
        } else if (avgDistance > MOVING_DISTANCE_THRESHOLD) {
            newState = "moving";
        } else {
            // 过渡状态，保持当前状态
            newState = currentState || "moving";
        }

        // 初始化状态
        if (currentState === null) {
            currentState = newState;
            stateStartIndex = i;
            stateStartTime = points[i].time;
            consecutiveSameState = 1;
        } else if (newState === currentState) {
            // 状态保持一致
            consecutiveSameState++;
        } else {
            // 状态可能改变，检查持续时间
            const stateDuration = (points[i].time - stateStartTime) / 1000; // 秒

            // 只有持续一定时间才真正转换状态（平滑处理）
            if (stateDuration >= MIN_STATE_DURATION_SECONDS) {
                // 标记之前的状态
                for (let j = stateStartIndex; j < i; j++) {
                    states[j] = currentState;
                }
                // 开始新状态
                currentState = newState;
                stateStartIndex = i;
                stateStartTime = points[i].time;
                consecutiveSameState = 1;
            } else {
                // 短暂变化，保持原状态（平滑处理）
                consecutiveSameState++;
            }
        }

        // 标记当前点的状态
        states[i] = currentState;
    }

    // 处理最后一个点
    if (states.length < points.length) {
        for (let i = states.length; i < points.length; i++) {
            states[i] = currentState;
        }
    }

    return states;
}

// 识别最近两趟数据（静止→移动→静止的模式）
// 从最近3小时的数据中，找到最近的两趟完整轨迹
function identifyRecentTrip(points) {
    if (points.length < 3) return points;

    // 使用配置文件中的轨迹识别参数
    const MIN_STATIONARY_DURATION = CONFIG.tripDetection.minStationaryDuration;
    const MIN_MOVING_DURATION = CONFIG.tripDetection.minMovingDuration;

    // 使用滑动窗口分析状态
    const states = analyzeMovementStatesForTrips(points);

    // 识别完整的静止→移动→静止模式（一趟）
    function findCompleteTrip(startIndex) {
        // 从startIndex往前查找：静止（结束）→ 移动段 → 静止（开始）
        let endStationaryStart = -1;
        let endStationaryEnd = -1;
        let movingStart = -1;
        let movingEnd = -1;
        let startStationaryStart = -1;
        let startStationaryEnd = -1;

        // 1. 从startIndex往前找结束静止段（需要持续一定时间）
        for (let i = startIndex; i >= 0; i--) {
            if (states[i] === "stationary") {
                let stationaryEnd = i;
                let stationaryStart = i;
                // 往前找到静止段的开始
                for (let j = i - 1; j >= 0 && states[j] === "stationary"; j--) {
                    stationaryStart = j;
                }
                // 检查静止段持续时间
                const duration = (points[stationaryEnd].time - points[stationaryStart].time) / 1000;
                if (duration >= MIN_STATIONARY_DURATION) {
                    endStationaryEnd = stationaryEnd;
                    endStationaryStart = stationaryStart;
                    break;
                }
                i = stationaryStart; // 跳过这个静止段，继续往前找
            }
        }

        if (endStationaryStart === -1) return null;

        // 2. 从结束静止段往前找移动段（需要持续一定时间）
        for (let i = endStationaryStart - 1; i >= 0; i--) {
            if (states[i] === "moving") {
                let movingEndIndex = i;
                let movingStartIndex = i;
                // 往前找到移动段的开始
                for (let j = i - 1; j >= 0 && states[j] === "moving"; j--) {
                    movingStartIndex = j;
                }
                // 检查移动段持续时间
                const duration = (points[movingEndIndex].time - points[movingStartIndex].time) / 1000;
                if (duration >= MIN_MOVING_DURATION) {
                    movingEnd = movingEndIndex;
                    movingStart = movingStartIndex;
                    break;
                }
                i = movingStartIndex; // 跳过这个移动段，继续往前找
            }
        }

        if (movingStart === -1 || movingEnd === -1) return null;

        // 3. 从移动段往前找开始静止段（需要持续一定时间）
        for (let i = movingStart - 1; i >= 0; i--) {
            if (states[i] === "stationary") {
                let stationaryEnd = i;
                let stationaryStart = i;
                // 往前找到静止段的开始
                for (let j = i - 1; j >= 0 && states[j] === "stationary"; j--) {
                    stationaryStart = j;
                }
                // 检查静止段持续时间
                const duration = (points[stationaryEnd].time - points[stationaryStart].time) / 1000;
                if (duration >= MIN_STATIONARY_DURATION) {
                    startStationaryEnd = stationaryEnd;
                    startStationaryStart = stationaryStart;
                    break;
                }
                i = stationaryStart; // 跳过这个静止段，继续往前找
            }
        }

        const tripStart = startStationaryStart !== -1 ? startStationaryStart : Math.max(0, movingStart - 5);
        const tripEnd = endStationaryEnd;

        return {
            start: tripStart,
            end: tripEnd,
            segments: {
                startStationary: [startStationaryStart, startStationaryEnd],
                moving: [movingStart, movingEnd],
                endStationary: [endStationaryStart, endStationaryEnd]
            }
        };
    }

    // 找到最近的两趟完整数据
    const trips = [];
    let searchIndex = points.length - 1;

    // 第一趟（最近的一趟）
    const firstTrip = findCompleteTrip(searchIndex);
    if (firstTrip) {
        trips.push(firstTrip);
        searchIndex = firstTrip.start - 1; // 从第一趟开始位置往前搜索第二趟
    }

    // 第二趟（往前的一趟）
    if (searchIndex >= 0) {
        const secondTrip = findCompleteTrip(searchIndex);
        if (secondTrip) {
            trips.push(secondTrip);
        }
    }

    if (trips.length === 0) {
        // 如果没找到完整的一趟，返回最后一段数据
        const recentCutoff = Math.max(0, points.length - 120); // 最近60分钟
        return points.slice(recentCutoff);
    }

    // 合并所有找到的趟次数据
    const allTripPoints = [];
    const usedIndices = new Set();

    trips.forEach((trip) => {
        for (let i = trip.start; i <= trip.end; i++) {
            if (!usedIndices.has(i)) {
                usedIndices.add(i);
                allTripPoints.push(points[i]);
            }
        }
    });

    // 按时间排序
    allTripPoints.sort((a, b) => a.time - b.time);

    // 检查并标记两趟数据之间的断点
    if (trips.length > 1) {
        console.log(`识别到 ${trips.length} 趟数据，总共 ${allTripPoints.length} 个点`);
        // 检查两趟数据之间是否有大跳跃
        for (let i = 1; i < allTripPoints.length; i++) {
            const prevPoint = allTripPoints[i - 1];
            const currentPoint = allTripPoints[i];
            const distance = calculateDistance(prevPoint.lat, prevPoint.lng, currentPoint.lat, currentPoint.lng);
            const timeDiff = (currentPoint.time - prevPoint.time) / 1000 / 60; // 分钟
            // 对于货车，移动距离更大，调整断点检测阈值
            if (distance > 200 && timeDiff > 2) {
                console.log(`检测到两趟数据之间的断点: 索引${i - 1}到${i}, 距离${distance.toFixed(2)}m, 时间间隔${timeDiff.toFixed(2)}分钟`);
            }
        }
    } else {
        console.log(`识别到 ${trips.length} 趟数据，总共 ${allTripPoints.length} 个点`);
    }

    return allTripPoints;
}

// 滤波算法：过滤掉变化不大的点
// 对于厂区电瓶车，30秒数据间隔，位移小于配置值说明车辆基本静止
// 过滤这些点可以简化轨迹，突出实际移动路径
function filterTrajectory(points, minDistance = CONFIG.trajectoryFilter.minDistance) {
    if (points.length <= 2) return points;

    // 首先应用GPS漂移滤波
    const driftFiltered = filterGPSDrift(points);

    if (driftFiltered.length <= 2) return driftFiltered;

    const filtered = [driftFiltered[0]]; // 保留第一个点

    // 然后应用距离滤波
    for (let i = 1; i < driftFiltered.length - 1; i++) {
        const prevPoint = filtered[filtered.length - 1];
        const currentPoint = driftFiltered[i];
        const distance = calculateDistance(prevPoint.lat, prevPoint.lng, currentPoint.lat, currentPoint.lng);

        // 如果距离大于阈值，保留该点
        if (distance >= minDistance) {
            filtered.push(currentPoint);
        }
    }

    // 保留最后一个点
    filtered.push(driftFiltered[driftFiltered.length - 1]);

    return filtered;
}

// 从API获取车辆历史轨迹数据
async function fetchVehicleTrajectory(deviceId, startDate, endDate) {
    try {
        const params = new URLSearchParams({
            customer_id: API_CONFIG.customerId,
            device_id: deviceId,
            type: "second",
            points: "[]",
            start: startDate,
            end: endDate
        });

        const url = `https://draw.cgboiler.com/v1/draw/cg/points/history/data?${params.toString()}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.c === 200 && data.d && data.d.length > 0) {
            return data.d;
        }

        return [];
    } catch (error) {
        console.error(`获取车辆 ${deviceId} 轨迹数据失败:`, error);
        return [];
    }
}

// 处理轨迹数据：将lat和lon配对成坐标点
function processTrajectoryData(rawData) {
    // 按时间分组
    const timeGroups = {};

    rawData.forEach((item) => {
        const time = item.time;
        if (!timeGroups[time]) {
            timeGroups[time] = {};
        }
        if (item.PN === "lat") {
            timeGroups[time].lat = parseFloat(item.value);
            timeGroups[time].time = new Date(time);
        } else if (item.PN === "lon") {
            timeGroups[time].lng = parseFloat(item.value);
        }
    });

    // 转换为数组，只保留同时有lat和lng的点
    const points = Object.values(timeGroups)
        .filter((point) => point.lat !== undefined && point.lng !== undefined)
        .sort((a, b) => a.time - b.time); // 按时间排序

    return points;
}

// 格式化日期字符串
function formatDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 打印轨迹点数据（包含两点间距离）
function printTrajectoryPoints(points, label) {
    console.log(`\n========== ${label} ==========`);
    console.log(`总点数: ${points.length}`);
    if (points.length === 0) {
        console.log("无数据");
        return;
    }

    const pointsWithDistance = [];
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        let distance = 0;
        if (i > 0) {
            distance = calculateDistance(points[i - 1].lat, points[i - 1].lng, point.lat, point.lng);
        }

        pointsWithDistance.push({
            index: i,
            lat: point.lat,
            lng: point.lng,
            time: point.time ? new Date(point.time).toLocaleString("zh-CN") : "N/A",
            distanceFromPrev: i > 0 ? distance.toFixed(2) + "m" : "-"
        });
    }

    console.table(pointsWithDistance);
    console.log(`========== ${label} 结束 ==========\n`);
}

// 获取车辆最近一趟轨迹数据
async function getVehicleTrajectory(vehicleId) {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) return [];

    const now = new Date();
    // 获取最近3小时的数据
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const startDate = formatDateString(threeHoursAgo);
    const endDate = formatDateString(now);

    // 从API获取原始轨迹数据
    const rawData = await fetchVehicleTrajectory(vehicleId, startDate, endDate);

    if (rawData.length === 0) {
        console.log(`车辆 ${vehicleId} 没有轨迹数据`);
        return [];
    }

    // 处理数据：配对lat和lon
    const points = processTrajectoryData(rawData);

    if (points.length === 0) {
        console.log(`车辆 ${vehicleId} 轨迹数据格式错误`);
        return [];
    }

    // 打印原始数据
    printTrajectoryPoints(points, "1. 原始轨迹数据");

    // 识别最近一趟数据（静止→移动→静止）
    const tripPoints = identifyRecentTrip(points);

    // 打印识别到的两趟数据
    printTrajectoryPoints(tripPoints, "2. 识别到的两趟轨迹数据");

    // 应用滤波算法，使用配置的最小距离阈值
    const filteredPoints = filterTrajectory(tripPoints, CONFIG.trajectoryFilter.minDistance);

    // 打印滤波后的轨迹数据
    printTrajectoryPoints(filteredPoints, "3. 滤波后的轨迹数据");

    console.log(`车辆 ${vehicleId} 统计: 原始轨迹点: ${points.length}, 一趟数据: ${tripPoints.length}, 滤波后: ${filteredPoints.length}`);

    return filteredPoints;
}

// 显示所有车辆位置
function displayAllVehicles() {
    // 清除现有标注
    markerLayerGroup.clearLayers();
    vehicleMarkers = {};

    vehicles.forEach((vehicle) => {
        // 根据状态选择图标颜色
        let iconColor = "red";
        if (vehicle.status === "无连接") {
            iconColor = "grey";
        }

        // 创建车辆标记
        const marker = L.marker([vehicle.currentLocation.lat, vehicle.currentLocation.lng], {
            icon: L.icon({
                iconUrl: `marker-icon-2x-${iconColor}.png`,
                shadowUrl: "marker-shadow.png",
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [0, -34],
                shadowSize: [41, 41]
            })
        });

        marker.addTo(markerLayerGroup);
        vehicleMarkers[vehicle.id] = marker;

        // 创建车辆标签（使用divIcon，支持同时显示多个）
        // 标签显示在标记上方，使用偏移量让标签在标记上方约50像素处
        const labelText = `[${formatRelativeTime(vehicle.lastUpdateTime)}] <strong>${vehicle.name}</strong>`;
        const labelIcon = L.divIcon({
            className: "vehicle-label",
            html: `<div class="vehicle-label-content">${labelText}</div>`,
            iconSize: [180, 30],
            iconAnchor: [90, 0] // 底部中心对齐（宽度的一半，高度）
        });

        // 标签位置在车辆标记上方，约50像素（在地图缩放级别18下约0.00045度）
        const labelOffset = 0.00038;
        const labelMarker = L.marker([vehicle.currentLocation.lat + labelOffset, vehicle.currentLocation.lng], {
            icon: labelIcon,
            interactive: false,
            zIndexOffset: 1000
        });

        labelMarker.addTo(markerLayerGroup);
    });

    // 如果有多辆车，调整地图视野以包含所有车辆
    // 只在首次加载时自动调整视野，避免刷新时频繁跳动
    if (vehicles.length > 0 && !refreshInterval) {
        const bounds = vehicles.map((v) => [v.currentLocation.lat, v.currentLocation.lng]);
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

// 计算两点之间的方位角（度数）
// 返回的是从北方向顺时针的角度
function calculateBearing(lat1, lng1, lat2, lng2) {
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const lat1Rad = (lat1 * Math.PI) / 180;
    const lat2Rad = (lat2 * Math.PI) / 180;

    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    let bearing = (Math.atan2(y, x) * 180) / Math.PI;
    bearing = (bearing + 360) % 360;

    // 转换为CSS旋转角度
    // CSS transform rotate: 0度指向右（东），顺时针为正
    // 方位角: 0度指向北，90度指向东，顺时针为正
    // 箭头符号 ▶ 默认指向右（东，0度）
    //
    // 角度对应关系（从point1到point2的方向）：
    // 如果point2在point1的北方（方位角0度），箭头应该指向上（CSS 270度或-90度）
    // 如果point2在point1的东方（方位角90度），箭头应该指向右（CSS 0度）
    // 如果point2在point1的南方（方位角180度），箭头应该指向下（CSS 90度）
    // 如果point2在point1的西方（方位角270度），箭头应该指向左（CSS 180度）
    //
    // 公式：CSS角度 = 方位角 - 90
    // 由于箭头方向反了，直接使用 (bearing - 90) 应该就对了
    return (bearing - 90 + 360) % 360;
}

// 添加方向箭头到轨迹线
function addDirectionArrows(latlngs) {
    // 每N个点添加一个箭头标记
    const arrowInterval = Math.max(1, Math.floor(latlngs.length / 20)); // 最多20个箭头

    // 存储箭头marker，以便后续清理
    const arrowMarkers = [];

    for (let i = arrowInterval; i < latlngs.length - 1; i += arrowInterval) {
        const point1 = latlngs[i - 1];
        const point2 = latlngs[i];

        // 计算角度（从point1到point2的方向）
        const bearing = calculateBearing(point1[0], point1[1], point2[0], point2[1]);

        // 创建箭头图标 - 使用更明显的箭头符号
        const arrowIcon = L.divIcon({
            className: "direction-arrow",
            html: `<div style="transform: rotate(${bearing}deg); color: #FF0000; font-size: 16px;">▶</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        // 在中间位置添加箭头标记
        const midLat = (point1[0] + point2[0]) / 2;
        const midLng = (point1[1] + point2[1]) / 2;

        const arrowMarker = L.marker([midLat, midLng], {
            icon: arrowIcon,
            interactive: false, // 箭头不可点击
            zIndexOffset: 1000 // 确保箭头在轨迹线上方
        });
        arrowMarker.addTo(trajectoryLayerGroup);
        arrowMarkers.push(arrowMarker);
    }

    return arrowMarkers;
}

// 显示车辆轨迹
async function displayVehicleTrajectory(vehicleId) {
    // 清除之前的所有轨迹（包括箭头）
    trajectoryLayerGroup.clearLayers();
    vehicleTrajectoryLayers = {};

    selectedVehicleId = vehicleId;

    // 显示加载状态
    updateVehicleList();

    // 异步获取轨迹数据，必须使用await
    const trajectory = await getVehicleTrajectory(vehicleId);

    // 确保trajectory是数组
    if (!Array.isArray(trajectory)) {
        console.error("轨迹数据格式错误，不是数组:", trajectory);
        updateVehicleList();
        return;
    }

    if (trajectory.length === 0) {
        console.log("没有找到轨迹数据");
        // 恢复列表显示
        updateVehicleList();
        return;
    }

    // 将轨迹点转换为LatLng数组
    const latlngs = trajectory.map((point) => [point.lat, point.lng]);

    // 识别静止段并计算停留时长
    const stationarySegments = identifyStationarySegments(trajectory);

    // 创建轨迹线配置
    const polylineOptions = {
        color: "#FF0000",
        weight: 4,
        opacity: 0.8,
        smoothFactor: 1
    };

    // 创建轨迹线
    const polyline = L.polyline(latlngs, polylineOptions);
    polyline.addTo(trajectoryLayerGroup);
    vehicleTrajectoryLayers[vehicleId] = polyline;

    // 添加方向箭头
    if (latlngs.length > 1) {
        addDirectionArrows(latlngs);
    }

    // 添加静止段标注（传递vehicleId以便获取车辆当前位置）
    addStationaryLabels(stationarySegments, trajectory, vehicleId);

    // 调整地图视野以显示完整轨迹
    map.fitBounds(polyline.getBounds(), { padding: [50, 50] });

    // 高亮选中的车辆（改变图标颜色）
    vehicles.forEach((v) => {
        if (vehicleMarkers[v.id]) {
            if (v.id === vehicleId) {
                // 选中状态使用红色图标
                vehicleMarkers[v.id].setIcon(
                    L.icon({
                        iconUrl: "marker-icon-2x-red.png",
                        shadowUrl: "marker-shadow.png",
                        iconSize: [25, 41],
                        iconAnchor: [12, 41],
                        popupAnchor: [1, -34],
                        shadowSize: [41, 41]
                    })
                );
            } else {
                // 其他车辆使用蓝色图标
                vehicleMarkers[v.id].setIcon(
                    L.icon({
                        iconUrl: "marker-icon-2x-red.png",
                        shadowUrl: "marker-shadow.png",
                        iconSize: [25, 41],
                        iconAnchor: [12, 41],
                        popupAnchor: [1, -34],
                        shadowSize: [41, 41]
                    })
                );
            }
        }
    });
}

// 使用滑动窗口和状态机识别移动状态
// 将轨迹看作波形图，平滑处理短暂的状态变化
function analyzeMovementStates(points) {
    if (points.length < 3) return [];

    // 使用配置文件中的移动状态识别参数
    const WINDOW_SIZE = CONFIG.movementDetection.windowSize;
    const STATIONARY_DISTANCE_THRESHOLD = CONFIG.movementDetection.stationaryDistanceThreshold;
    const MOVING_DISTANCE_THRESHOLD = CONFIG.movementDetection.movingDistanceThreshold;
    const MIN_STATE_DURATION = CONFIG.movementDetection.minStateDuration;
    const MIN_STATIONARY_DURATION = CONFIG.stationaryLabel.minStationaryDuration;

    // 先计算相邻点之间的距离（distances[i] 对应 points[i] 到 points[i+1] 的距离）
    const distances = [];
    for (let i = 1; i < points.length; i++) {
        const dist = calculateDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
        distances.push(dist);
    }

    // 使用滑动窗口和状态机识别持续的状态（states数组对应points数组）
    const states = new Array(points.length);
    let currentState = null;
    let stateStartIndex = 0; // points的索引
    let stateStartTime = points[0].time;

    // 第一个点的状态需要根据第一个距离判断
    if (distances.length > 0) {
        states[0] = distances[0] < STATIONARY_DISTANCE_THRESHOLD ? "stationary" : "moving";
        currentState = states[0];
    } else {
        return [];
    }

    // 从第二个点开始（points索引从1开始，对应distances索引从0开始）
    for (let pointIdx = 1; pointIdx < points.length; pointIdx++) {
        const distIdx = pointIdx - 1; // distances数组的索引

        // 使用滑动窗口计算平均距离
        let windowStart = Math.max(0, distIdx - Math.floor(WINDOW_SIZE / 2));
        let windowEnd = Math.min(distances.length - 1, distIdx + Math.floor(WINDOW_SIZE / 2));

        let totalDist = 0;
        let count = 0;
        for (let j = windowStart; j <= windowEnd; j++) {
            totalDist += distances[j];
            count++;
        }

        const avgDistance = count > 0 ? totalDist / count : 0;

        // 判断当前状态
        let newState;
        if (avgDistance < STATIONARY_DISTANCE_THRESHOLD) {
            newState = "stationary";
        } else if (avgDistance > MOVING_DISTANCE_THRESHOLD) {
            newState = "moving";
        } else {
            // 过渡状态，保持当前状态
            newState = currentState;
        }

        if (newState === currentState) {
            // 状态保持一致
            states[pointIdx] = currentState;
        } else {
            // 状态可能改变，检查持续时间
            const stateDuration = (points[pointIdx].time - stateStartTime) / 1000; // 秒

            // 只有持续一定时间才真正转换状态（平滑处理）
            if (stateDuration >= MIN_STATE_DURATION) {
                // 状态真正转换
                currentState = newState;
                stateStartIndex = pointIdx;
                stateStartTime = points[pointIdx].time;
                states[pointIdx] = currentState;
            } else {
                // 短暂变化，保持原状态（平滑处理）
                states[pointIdx] = currentState;
            }
        }
    }

    // 识别静止段
    const segments = [];
    let stationaryStart = null;

    for (let i = 0; i < states.length; i++) {
        if (states[i] === "stationary") {
            if (stationaryStart === null) {
                stationaryStart = i;
            }
        } else {
            // 状态改变，检查是否结束了一个静止段
            if (stationaryStart !== null) {
                const duration = (points[i - 1].time - points[stationaryStart].time) / 1000;
                if (duration >= MIN_STATIONARY_DURATION) {
                    segments.push({
                        startIndex: stationaryStart,
                        endIndex: i - 1,
                        duration: duration,
                        lat: points[stationaryStart].lat,
                        lng: points[stationaryStart].lng
                    });
                }
                stationaryStart = null;
            }
        }
    }

    // 处理最后一段（如果轨迹以静止段结束）
    if (stationaryStart !== null) {
        const duration = (points[points.length - 1].time - points[stationaryStart].time) / 1000;
        if (duration >= MIN_STATIONARY_DURATION) {
            segments.push({
                startIndex: stationaryStart,
                endIndex: points.length - 1,
                duration: duration,
                lat: points[stationaryStart].lat,
                lng: points[stationaryStart].lng
            });
        }
    }

    console.log(`识别到 ${segments.length} 个停留段（超过1分钟）`);
    return segments;
}

// 识别静止段并计算停留时长（使用改进的算法）
function identifyStationarySegments(points) {
    return analyzeMovementStates(points);
}

// 格式化停留时长
function formatDuration(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)}秒`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return secs > 0 ? `${minutes}分${secs}秒` : `${minutes}分钟`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
    }
}

// 检查最后一个点是否为静止状态（使用与analyzeMovementStates相同的阈值逻辑）
function isLastPointStationary(points) {
    if (points.length < 2) return false;

    const STATIONARY_DISTANCE_THRESHOLD = CONFIG.movementDetection.stationaryDistanceThreshold;
    const WINDOW_SIZE = Math.min(CONFIG.movementDetection.windowSize, points.length - 1);

    // 计算最后几个点的平均距离（使用滑动窗口）
    const lastDistIdx = points.length - 2; // 最后一个距离的索引（points[i-1]到points[i]）
    const windowStart = Math.max(0, lastDistIdx - Math.floor(WINDOW_SIZE / 2));
    const windowEnd = Math.min(points.length - 2, lastDistIdx + Math.floor(WINDOW_SIZE / 2));

    let totalDist = 0;
    let count = 0;

    for (let i = windowStart; i <= windowEnd; i++) {
        if (i < points.length - 1) {
            const dist = calculateDistance(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
            totalDist += dist;
            count++;
        }
    }

    const avgDistance = count > 0 ? totalDist / count : 0;
    return avgDistance < STATIONARY_DISTANCE_THRESHOLD;
}

// 添加静止段标注（显示在车辆标记上方，仅当车辆静止时显示）
function addStationaryLabels(segments, points, vehicleId) {
    // 如果没有停留段，不显示
    if (segments.length === 0) return;

    // 检查最后一个点是否为静止状态
    if (!isLastPointStationary(points)) {
        return; // 车辆在移动，不显示停留信息
    }

    // 只显示最后一个停留段（当前所在地的停留）
    const lastSegment = segments[segments.length - 1];

    // 获取车辆当前位置（使用车辆标记的位置，而不是静止段的中心）
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (!vehicle || !vehicleMarkers[vehicleId]) {
        return;
    }

    const vehiclePosition = vehicleMarkers[vehicleId].getLatLng();
    const labelText = `停留: ${formatDuration(lastSegment.duration)}`;

    // 创建真实的DOM div元素作为图标
    // 调整锚点，让标签显示在车辆标记上方（车辆标记高度约41px，popup在标记上方，标签要在popup上方）
    const labelIcon = L.divIcon({
        className: "stationary-label",
        html: `<div style="
            display: inline-block;
            background-color: rgba(46, 125, 50, 0.95);
            border: 2px solid #2E7D32;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 0.85rem;
            font-weight: 600;
            color: #FFFFFF;
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
            text-align: center;
            line-height: 1.2;
            pointer-events: none;
        ">${labelText}</div>`,
        iconSize: [120, 30],
        iconAnchor: [60, 0] // 底部中心锚点，让标签显示在标记上方
    });

    // 计算标签位置（车辆标记上方，考虑popup的高度）
    // 在zoom level 18下，约0.001度纬度≈111米，标签需要显示在标记+popup上方约80-100像素处
    // 使用约0.0009度（约100米）的偏移，让标签显示在popup上方
    const labelOffset = 0.0005;
    const labelMarker = L.marker([vehiclePosition.lat + labelOffset, vehiclePosition.lng], {
        icon: labelIcon,
        interactive: false,
        zIndexOffset: 2000
    });

    labelMarker.addTo(trajectoryLayerGroup);
}

// 清除轨迹显示
function clearTrajectory() {
    trajectoryLayerGroup.clearLayers();
    vehicleTrajectoryLayers = {};
    selectedVehicleId = null;

    vehicles.forEach((v) => {
        if (vehicleMarkers[v.id]) {
            vehicleMarkers[v.id].setIcon(
                L.icon({
                    iconUrl: "marker-icon-2x-red.png",
                    shadowUrl: "marker-shadow.png",
                    iconSize: [25, 41],
                    iconAnchor: [12, 41],
                    popupAnchor: [1, -34],
                    shadowSize: [41, 41]
                })
            );
        }
    });
}

// 格式化日期时间
function formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

// 格式化相对时间（如"5分钟前"）
function formatRelativeTime(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return "刚刚";
}

// 更新车辆列表UI
function updateVehicleList() {
    const vehicleList = document.getElementById("vehicle-list");

    if (vehicles.length === 0) {
        vehicleList.innerHTML = '<p class="empty-message">暂无车辆数据</p>';
        return;
    }

    vehicleList.innerHTML = vehicles
        .map((vehicle) => {
            const isSelected = selectedVehicleId === vehicle.id;
            const relativeTime = formatRelativeTime(vehicle.lastUpdateTime);
            const absoluteTime = formatDateTime(vehicle.lastUpdateTime);

            // 根据状态设置CSS类
            let statusClass = "running";
            if (vehicle.status === "无连接") {
                statusClass = "stopped";
            }

            return `
            <div class="vehicle-item ${isSelected ? "selected" : ""}" onclick="selectVehicle('${vehicle.id}')">
                <div class="vehicle-header">
                    <div class="vehicle-name">${vehicle.name}</div>
                </div>
                <div class="vehicle-info">
                    <div class="vehicle-time" title="${absoluteTime}">
                        更新时间: ${relativeTime}
                    </div>
                </div>
            </div>
        `;
        })
        .join("");
}

// 选择车辆并显示最近一趟轨迹
async function selectVehicle(vehicleId) {
    // 如果点击的是已选中的车辆，则清除轨迹
    if (selectedVehicleId === vehicleId) {
        clearTrajectory();
        updateVehicleList();
        return;
    }

    // 显示最近一趟轨迹
    await displayVehicleTrajectory(vehicleId);
}

// 启动定时刷新
function startAutoRefresh() {
    // 清除之前的定时器（如果存在）
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }

    // 每1分钟（60000毫秒）刷新一次
    refreshInterval = setInterval(async () => {
        console.log("自动刷新车辆数据...");
        await fetchAllVehicles();
    }, 60000);

    console.log("已启动自动刷新，每1分钟更新一次");
}

// 停止定时刷新
function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
        console.log("已停止自动刷新");
    }
}

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", function () {
    // 初始化地图
    initMap();

    // 加载车辆数据
    loadVehicles().then(() => {
        // 启动自动刷新
        startAutoRefresh();
    });

    console.log("地图初始化完成");
});

// 页面卸载时清理定时器
window.addEventListener("beforeunload", function () {
    stopAutoRefresh();
});

// 将函数暴露到全局作用域
window.selectVehicle = selectVehicle;
window.selectVehicle = selectVehicle;
