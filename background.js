let body = {};
let headerData = {};
let cookie = "";
let headerFound = false;
let bodyFound = false;
let cookieFound = false;

async function getCookies(url) {
    let cookieComplete = false;
    let cookieValue = "";
    const cookies = await chrome.cookies.getAll({ url: url });
    cookies.forEach((cookie) => {
        if (!cookieComplete) {
            if (cookie.name.includes("sfdc-stream")) {
                cookieComplete = true;
            }
            cookieValue += cookie.name + "=" + cookie.value + ";";
        }
    });
    return cookieValue;
}

function getHeaderData(details) {
    const { requestHeaders } = details;
    const headerData = {};
    try {
        if (requestHeaders) {
            requestHeaders.forEach((header) => {
                headerData[header.name] = header.value;
            });
        }
    } catch (error) {
        console.log(error);
    }
    return headerData;
}

function getBody(details) {
    let body = {};
    try {
        const message = details.requestBody.formData.message[0];
        const parsedMessage = JSON.parse(message);
        const descriptor = parsedMessage.actions[0].descriptor;
        if (
            descriptor.includes(
                "apex://PED_CurveDiCaricoController/ACTION$QueryLoadProfile"
            )
        ) {
            const formData = details.requestBody.formData;
            //ogni dato di formData è un array di stringhe. Prendo il primo elemento
            for (const [key, value] of Object.entries(formData)) {
                body[key] = value[0];
            }

        }
    } catch (error) {
        console.log(error);
    }
    return body
}

chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        
        if (
            details.method === "POST" &&
            details.requestBody &&
            details.requestBody.formData &&
            details.requestBody.formData.message &&
            details.requestBody.formData.message.length > 0 &&
            !bodyFound
        ) {
            body = getBody(details);
            console.log("body:", body);
            bodyFound = Object.keys(body).length > 0;
        }
        if (bodyFound && !cookieFound) {
            getCookies(details.url).then((response) => {
                cookie = response;
                cookieFound = response.length > 0;
            });
        }
        //se ho trovato tutto chiudo il listener
        if (bodyFound && cookieFound && headerFound) {
            chrome.webRequest.onBeforeRequest.removeListener();
            chrome.webRequest.onBeforeSendHeaders.removeListener();
            chrome.storage.local.set({ body, headerData, cookie });
        }
    },
    { urls: ["<all_urls>"] },
    ["requestBody"]
);

chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        if (!headerFound && bodyFound) {
            headerData = getHeaderData(details);
            console.log("headerData:", headerData);
            headerFound = Object.keys(headerData).length > 0;
        }
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders"]
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getReqData") {
        chrome.storage.local.get(["body", "headerData", "cookie"], (result) => {
            console.log(result);
            sendResponse(result);
        });
    }
});
