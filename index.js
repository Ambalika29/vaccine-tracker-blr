const fetch = require('node-fetch');
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const DISTRICT_ID_BBMP = 294;
const DISTRICT_ID_BENGALURU_URBAN = 265;
const DISTRICT_ID_BENGALURU_RURAL = 276;


const queryArea = [DISTRICT_ID_BBMP, DISTRICT_ID_BENGALURU_URBAN, DISTRICT_ID_BENGALURU_RURAL];
const getFormattedDate = () => {
    const currentDate = new Date();
    const day = currentDate.getDate() > 9 ? currentDate.getDate() : `0${currentDate.getDate()}`;
    const month = (currentDate.getMonth() + 1) > 9 ? currentDate.getMonth() + 1 : `0${currentDate.getMonth() + 1}`;
    const year = currentDate.getFullYear();
    return `${day}-${month}-${year}`;
}

const dateParam = getFormattedDate();

const fetchData = (districtId, date) => {
    return fetch(`https://cdn-api.co-vin.in/api/v2/appointment/sessions/calendarByDistrict?district_id=${districtId}&date=${date}`,
        { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36" } }
    )
        .then(res => res.json())
        .then(json => json);
}

const sendMessageToTelegram = (chatId, message) => {
    return fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: message
        }),
    });
}

const promiseMap = queryArea.map(area => fetchData(area, dateParam));

const getTotalAvailableSlots = (slotData) => {
    if (!slotData || !slotData.length) {
        return 0;
    }

    let totalCount = 0;

    for (slot of slotData) {
        totalCount += slot.available_capacity;
    }

    return totalCount;
}

const findRelevantList = (centerData) => {
    if (!centerData || !centerData.length) {
        return [];
    }
    const relevantInfo = [];
    // const paidCenters = centerData.filter(center => center.fee_type === "Paid");
    centerData.forEach(center => {
        const validSessions = center.sessions.filter(session => session.available_capacity > 0 && session.min_age_limit === 45);
        if (validSessions.length) {
            const { name, district_name, pincode, fee_type } = center;
            const capacity = getTotalAvailableSlots(validSessions);
            const vaccine = validSessions[0].vaccine;
            let vaccineCost = 0;
            if (fee_type === "Paid" && center.vaccine_fees) {
                vaccineCost = center.vaccine_fees.fee;
            }
            let slotInfo = {};
            for (const session of validSessions) {
                slotInfo[session.date] = session.available_capacity;
            }
            relevantInfo.push({ name, district_name, pincode, fee_type, capacity, vaccineCost, slotInfo, vaccine });
            return true;
        }
        return false;
    })
    return relevantInfo;
}

const formatData = (centerData) => {
    let str = "\n";

    for (const abc of centerData) {
        if (!abc || !abc.length) {
            break;
        }
        for (const info of abc) {
            for (const key in info) {
                if (key !== "slots")
                    str += `${key}: ${info[key]}\n`;
                else {
                    str += `${key}:\n`
                    for (slot of info.slots) {
                        for (const key in slot) {
                            if (slot[key])
                                str += `\t${key}: ${slot[key]}\n`;
                        }
                        str += "\n";
                    }
                    str += "\n";
                }
            }
            str += "\n\n";
        }
    }
    return str;
}

const sortArray = (msgQue) => {
    return msgQue.sort((a, b) => {
        if (a.capacity > b.capacity) {
            return -1;
        }
        if (a.capacity < b.capacity) {
            return 1;
        }
        return 0;
    });
}

const formatTelegramData = (centerData) => {
    // console.log(centerData);
    let msgQueue = [];

    for (const abc of centerData) {
        if (!abc || !abc.length) {
            break;
        }
        sortArray(abc);
        for (const info of abc) {
            let telegramStr = "";
            telegramStr += `PINCODE: ${info.pincode}\n`;
            telegramStr += `HOSPITAL: ${info.name.toUpperCase()}\n`;
            telegramStr += `DISTRICT: ${info.district_name.toUpperCase()}\n`;
            telegramStr += `TYPE: ${info.fee_type.toUpperCase()}\n`;
            if (info.vaccine) {
                telegramStr += `VACCINE: ${info.vaccine.toUpperCase()}\n`;
            }
            if (info.vaccineCost) {
                telegramStr += `COST: ${info.vaccineCost}/-\n`;
            }
            for (const key in info.slotInfo) {
                telegramStr += `${key}: ${info.slotInfo[key]}\n`;
            }

            telegramStr += `\nHurry! Visit https://selfregistration.cowin.gov.in/ to book\n`;
            msgQueue.push(telegramStr);
        }
    }
    return msgQueue;
}

return Promise.allSettled(promiseMap)
    .then(data => {
        const centerData = [];
        data.forEach(datum => {
            if (datum.status === "fulfilled") {
                const res = findRelevantList(datum.value.centers);
                if (res.length) {
                    centerData.push(res);
                }
            } else {
                console.log(datum);
            }
        })

        if (centerData.length) {
            const msgQueue = formatTelegramData(centerData);
            console.log(msgQueue.length);
            if (msgQueue && msgQueue.length) {
                if (msgQueue.length > 9) {
                    msgQueue.splice(9);
                    msgQueue.push("Please visit https://selfregistration.cowin.gov.in/ for more available centers");
                }

                msgQueue.forEach(msg => {
                    sendMessageToTelegram(CHAT_ID, msg);
                })
            }

        }
    })
    .catch(err => console.log(err));

