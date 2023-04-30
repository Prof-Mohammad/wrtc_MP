var myID;
var _peer_list = {};
// socketio
var protocol = window.location.protocol;
var socket = io(protocol + '//' + document.domain + ':' + location.port, {autoConnect: false});

var camera_allowed=false;
var mediaConstraints = {
    audio: true, // We want an audio track
    video: {
        autoplay: true,
        height: 360
    } // ...and we want a video track
};

const constOptions= {"selfieMode":true,
                 "maxNumHands":2,
                 "minDetectionConfidence":0.5,
                  "minTrackingConfidence":0.5};
document.addEventListener("DOMContentLoaded", (event)=>{
    startCamera();
});

// local camera start
function startCamera()
{
    navigator.mediaDevices.getUserMedia(mediaConstraints)
    .then((stream)=>{
        myVideo.srcObject = stream;
        camera_allowed = true;
        setAudioMuteState(audioMuted);                
        setVideoMuteState(videoMuted);

        // hands detect in frames
        handsDetectCameraLocal(myVideo,constOptions, 480, 480).start()

        //start the socketio connection
        socket.connect();
    })
    .catch((e)=>{
        console.log("getUserMedia Error! ", e);
        alert("Error! Unable to access camera or mic! ");
    });
}


//-------------------------------------------------

// python server
socket.on("connect", ()=>{
    console.log("socket connected....");
    socket.emit("join-room", {"room_id": myRoomID});
});

socket.on("user-connect", (data)=>{
    console.log("user-connect ", data);
    let peer_id = data["sid"];
    let display_name = data["name"];
    _peer_list[peer_id] = undefined; // add new user to user list
    addVideoElement(peer_id, display_name);
    handsDetectCameraRemote(peer_id ,getVideoObj(peer_id), display_name ,constOptions,480, 480).start()
});


socket.on("user-disconnect", (data)=>{
    console.log("user-disconnect ", data);
    let peer_id = data["sid"];
    closeConnection(peer_id);
    removeVideoElement(peer_id);
    removeCanvasElement(peer_id);
});


socket.on("user-list", (data)=>{
    console.log("user list recvd ", data);
    myID = data["my_id"];
    if( "list" in data) // not the first to connect to room, existing user list recieved
    {
        let recvd_list = data["list"];
        // add existing users to user list
        for(peer_id in recvd_list)
        {
            display_name = recvd_list[peer_id];
            _peer_list[peer_id] = undefined;
            addVideoElement(peer_id, display_name);
            handsDetectCameraRemote(peer_id ,getVideoObj(peer_id), display_name ,constOptions,480, 480).start()
        }
        start_webrtc();
    }    
});
//---------------------------------------
function closeConnection(peer_id)
{
    if(peer_id in _peer_list)
    {
        _peer_list[peer_id].onicecandidate = null;
        _peer_list[peer_id].ontrack = null;
        _peer_list[peer_id].onnegotiationneeded = null;

        delete _peer_list[peer_id]; // remove user from user list
    }
}

function log_user_list()
{
    for(let key in _peer_list)
    {
        console.log(`${key}: ${_peer_list[key]}`);
    }
}

//---------------[ webrtc ]--------------------    

var PC_CONFIG = {
    iceServers: [
        {
            urls: ['stun:stun.l.google.com:19302', 
                    'stun:stun1.l.google.com:19302',
                    'stun:stun2.l.google.com:19302',
                    'stun:stun3.l.google.com:19302',
                    'stun:stun4.l.google.com:19302'
                ]
        },
    ]
};

function log_error(e){console.log("[ERROR] ", e);}
function sendViaServer(data){socket.emit("data", data);}

socket.on("data", (msg)=>{
    switch(msg["type"])
    {
        case "offer":
            handleOfferMsg(msg);
            break;
        case "answer":
            handleAnswerMsg(msg);
            break;
        case "new-ice-candidate":
            handleNewICECandidateMsg(msg);
            break;
    }
});

function start_webrtc()
{

    // send offer to all other members
    for(let peer_id in _peer_list)
    {
       invite(peer_id);
    }
}

function invite(peer_id)
{
    if(_peer_list[peer_id]){console.log("[Not supposed to happen!] Attempting to start a connection that already exists!")}
    else if(peer_id === myID){console.log("[Not supposed to happen!] Trying to connect to self!");}
    else
    {
        console.log(`Creating peer connection for <${peer_id}> ...`);
        createPeerConnection(peer_id);

        let local_stream = myVideo.srcObject;
        local_stream.getTracks().forEach((track)=>{
            _peer_list[peer_id].addTrack(track, local_stream);
        });
    }

}
function createPeerConnection(peer_id)
{
    _peer_list[peer_id] = new RTCPeerConnection(PC_CONFIG);

    _peer_list[peer_id].onicecandidate = (event) => {handleICECandidateEvent(event, peer_id)};
    _peer_list[peer_id].ontrack = (event) => {handleTrackEvent(event, peer_id)};
    _peer_list[peer_id].onnegotiationneeded = () => {handleNegotiationNeededEvent(peer_id)};

}


function handleNegotiationNeededEvent(peer_id)
{
    _peer_list[peer_id].createOffer()
    .then((offer)=>{return _peer_list[peer_id].setLocalDescription(offer);})
    .then(()=>{
        console.log(`sending offer to <${peer_id}> ...`);
        sendViaServer({
            "sender_id": myID,
            "target_id": peer_id,
            "type": "offer",
            "sdp": _peer_list[peer_id].localDescription
        });
    })
    .catch(log_error);
} 

function handleOfferMsg(msg)
{
    peer_id = msg['sender_id'];

    console.log(`offer recieved from <${peer_id}>`);
    
    createPeerConnection(peer_id);
    let desc = new RTCSessionDescription(msg['sdp']);
    _peer_list[peer_id].setRemoteDescription(desc)
    .then(()=>{
        let local_stream = myVideo.srcObject;
        local_stream.getTracks().forEach((track)=>{_peer_list[peer_id].addTrack(track, local_stream);});
    })
    .then(()=>{return _peer_list[peer_id].createAnswer();})
    .then((answer)=>{return _peer_list[peer_id].setLocalDescription(answer);})
    .then(()=>{
        console.log(`sending answer to <${peer_id}> ...`);
        sendViaServer({
            "sender_id": myID,
            "target_id": peer_id,
            "type": "answer",
            "sdp": _peer_list[peer_id].localDescription
        });
    })
    .catch(log_error);
}

function handleAnswerMsg(msg)
{
    peer_id = msg['sender_id'];
    console.log(`answer recieved from <${peer_id}>`);
    let desc = new RTCSessionDescription(msg['sdp']);
    _peer_list[peer_id].setRemoteDescription(desc)
}


function handleICECandidateEvent(event, peer_id)
{
    if(event.candidate){
        sendViaServer({
            "sender_id": myID,
            "target_id": peer_id,
            "type": "new-ice-candidate",
            "candidate": event.candidate
        });
    }
}

function handleNewICECandidateMsg(msg)
{
    console.log(`ICE candidate recieved from <${peer_id}>`);
    var candidate = new RTCIceCandidate(msg.candidate);
    _peer_list[msg["sender_id"]].addIceCandidate(candidate)
    .catch(log_error);
}


function handleTrackEvent(event, peer_id)
{
    console.log(`track event recieved from <${peer_id}>`);
    
    if(event.streams)
    {
        getVideoObj(peer_id).srcObject = event.streams[0];
    }
}

//----------------[ media pipe]-------------------------
// media pipe

// hands detector init local video
function handsDetectCameraLocal(local_video,options, width, height){
    var  camera ;
    const hands = createHands()
    const htmlElements= getHTMLMPElements()
    hands.onResults(results => onResultsHands("local", results, htmlElements));
    camera = createCamera(htmlElements.video,hands,width,height)
    // camera = createCamera(local_video,hands,width,height)
    createControlPanel(hands,htmlElements,options)
    return camera;
}

// hands detector init remot video
function handsDetectCameraRemote(peer_id, video, display_name, options, width, height){
    const htmlElements= createHTMLMPElements(peer_id)
    addCanvasElement(htmlElements,peer_id,display_name)
    var  camera ;
    const hands = createHands()
    hands.onResults(results => onResultsHands(peer_id, results, htmlElements));
    camera=createCamera( video,hands,width,height)
    createControlPanel(hands,htmlElements,options)
    return camera;
}
// camera create to detect hand
function createCamera(video, hands, width, height){
    return new Camera(video, {
        onFrame: async () => {
            await hands.send({image: video});
        },
        width: width,
        height: height
    });
}

// media pipe hand object init
function  createHands(){
    const hands =new Hands({locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.1/${file}`;}
    });
    return hands;
}

// get html ids
function getHTMLIds(id){
    const iD={
        "video":"videoCamera",
        "canvas": "output",
        "controls":"control"
    }
  if(id.length===0)
      return iD;
  iD.video+=id;
  iD.controls+=id;
  iD.canvas+=id;

    return iD;
}

// canvas init to show processed frame
function getHTMLMPElements(){
    const iD=getHTMLIds("");
    let video = document.getElementById(iD.video);
    let canvas = document.getElementsByClassName(iD.canvas)[0];
    let controls = document.getElementsByClassName(iD.controls)[0];
    let canvasCtx = canvas.getContext('2d');
    let fpsControl = new FPS();
    return {"video":video,"canvas":canvas,"controls":controls,"canvasCtx":canvasCtx,"fpsControl":fpsControl};
}

function createHTMLMPElements(peer_id){
    const iD=getHTMLIds(peer_id);
    let video = document.createElement("video");
    video.id=iD.video
    video.autoplay=true
    video.style="display: none"

    let canvas = document.createElement("canvas");
    canvas.className=iD.canvas

    let controls = document.createElement("div");
    controls.id= iD.controls
    controls.style="visibility: hidden;"

    let canvasCtx = canvas.getContext('2d')
    let fpsControl = new FPS();
    return {"video":video,"canvas":canvas,"controls":controls,"canvasCtx":canvasCtx,"fpsControl":fpsControl};
}
// process frame to detect hand
function onResultsHands(peer_id,results, htmlElement) {
  const canvas = htmlElement.canvas
  const canvasCtx = htmlElement.canvasCtx
  const fpsControl = htmlElement.fpsControl
  canvasCtx.font = '20px Arial';
  canvasCtx.fillStyle = 'red';
  canvasCtx.textAlign = 'center';

  document.body.classList.add('loaded');
  fpsControl.tick();
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  // canvasCtx.translate(canvas.width, 0);
  // canvasCtx.scale(-1, 1);
  canvasCtx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  if (results.multiHandLandmarks && results.multiHandedness) {
    // for (let index = 0; index < results.multiHandLandmarks.length; index++) {
      let index=0;
        const classification = results.multiHandedness[index];
        const isRightHand = classification.label === 'Right';
        const landmarks = results.multiHandLandmarks[index];
        let angles = calculateAngles(landmarks,isRightHand);
         showAngles(canvas,canvasCtx, angles,[landmarks[1],landmarks[5],landmarks[9],landmarks[17]]);
         // drawCirclesDefault(canvas, canvasCtx, landmarks);
         drawCirclesDefault(canvas,canvasCtx,[landmarks[1],landmarks[5],landmarks[9],landmarks[17]])
         drawLinesDefault(canvas,canvasCtx,landmarks)
      // drawLine(canvas,canvasCtx,landmarks[0], landmarks[1],"red",10)

        // drawLandmarks(
        //       canvasCtx, landmarks, {
        //       color: isRightHand ? '#00FF00' : '#FF0000',
        //       fillColor: isRightHand ? '#FF0000' : '#00FF00',
        //       radius: (x) => {
        //         return lerp(x.from.z, -0.15, .1, 5, 1);
        //       }
        // });

      }
  // }


  canvasCtx.restore();
}





// control panel create
function createControlPanel(hands,htmlElement,options) {
    const video =htmlElement.video
    const controls = htmlElement.controls
    const fpsControl = htmlElement.fpsControl

    const selfieMode = options.selfieMode;
    const maxNumHands = options.maxNumHands;
    const minDetectionConfidence= options.minDetectionConfidence;
    const minTrackingConfidence= options.minTrackingConfidence;
    new ControlPanel(controls, {
        selfieMode: selfieMode,
        maxNumHands: maxNumHands,
        minDetectionConfidence: minDetectionConfidence,
        minTrackingConfidence: minTrackingConfidence
    })
        .add([
            new StaticText({title: 'MediaPipe Hands'}),
            fpsControl,

            new Toggle({title: 'Selfie Mode', field: 'selfieMode'}),

            new Slider(
                {title: 'Max Number of Hands', field: 'maxNumHands', range: [1, 4], step: 1}),

            new Slider({
                title: 'Min Detection Confidence',
                field: 'minDetectionConfidence',
                range: [0, 1],
                step: 0.01
            }),

            new Slider({
                title: 'Min Tracking Confidence',
                field: 'minTrackingConfidence',
                range: [0, 1],
                step: 0.01
            }),
        ])
        .on(options => {
            video.classList.toggle('selfie', options.selfieMode);
            hands.setOptions(options);
        });
}


function calculateAngles(landmarks, isRightHand) {
    const angles = [];
    let p1 = 4
    let p2 = 2
    landmarks[2] = getMiddlePoint(landmarks[2],landmarks[5])
    let p3 = 6

    let p4 = 8
    let p5 = 5
    landmarks[5] = getMiddlePoint(landmarks[5],landmarks[9])
    let p6 = 12

    let p7 = 12
    let p8 = 9
    landmarks[9] = getMiddlePoint(landmarks[9],landmarks[13])
    let p9 = 16

    let p10 = 16
    let p11 = 13
    landmarks[13] = getMiddlePoint(landmarks[13],landmarks[17])
    let p12 = 20


    const fingers = [
        [p1, p2, p3],
        [p4, p5, p6],
        [p7, p8, p9],
        [p10, p11, p12],
    ];

    let angle;
    for (let i = 0; i < fingers.length; i++) {
        const [p1, p2, p3] = fingers[i].map(idx => landmarks[idx]);
        const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
        angle = radians * 180 / Math.PI;
        angle = angle < 0 ? angle + 360 : angle;
        angle = reCalculateAngle(landmarks, angle, isRightHand)
        angles.push(Math.round(angle));
    }

    return angles;
}

function reCalculateAngle(landmarks, angle, isRightHand){
    if(isRightHand && landmarks[0].x < landmarks[20].x)
        return angle
    if(isRightHand && landmarks[0].x > landmarks[20].x)
        return 360-angle
    if(landmarks[0].x > landmarks[20].x)
        return 360-angle
    if(landmarks[0].x < landmarks[20].x)
        return angle
}

function showAngles(canvas,canvasCtx, angles, points){
    for(let i=0;i<angles.length;i++){
        canvasCtx.fillText(angles[i], points[i].x*canvas.width, points[i].y*canvas.height);
    }
}

function  drawCirclesDefault(canvas,canvasCtx, points) {
    drawCircles(canvas,canvasCtx, points, 3, "red")
}
function  drawCircles(canvas,canvasCtx, points, radius, color){
    for (let i = 0; i < points.length; i++){
        drawCircle(canvas, canvasCtx,points[i],radius,color)
    }
}
function drawCircle(canvas,canvasCtx, point, radius, color) {
        const startAngle = 0;
        const endAngle = Math.PI * 2;
        const counterClockwise = false;
        canvasCtx.beginPath();
        canvasCtx.arc(point.x * canvas.width, point.y * canvas.height, radius, startAngle, endAngle, counterClockwise);
        canvasCtx.stroke();
        canvasCtx.fillStyle = color;
        canvasCtx.fill();
}

function drawLinesDefault(canvas,canvasCtx,landmarks){



    const lines = [];

    let l1 = {"start": landmarks[1], "end": landmarks[4]};
    lines.push(l1)
    let l2 = {"start": landmarks[1], "end": landmarks[5]};
    lines.push(l2)


    let l3 = {"start": landmarks[8], "end": landmarks[5]};
    lines.push(l3)
    let l4 = {"start": landmarks[5], "end": landmarks[12]};
    lines.push(l4)



    let l5 = {"start": landmarks[12], "end": landmarks[9]};
    lines.push(l5)
    let l6 = {"start": landmarks[9], "end": landmarks[16]};
    lines.push(l6)


    let l7 = {"start": landmarks[16], "end": landmarks[13]};
    lines.push(l7)
    let l8 = {"start": landmarks[13], "end": landmarks[20]};
    lines.push(l8)
    drawLines(canvas,canvasCtx,lines)


}
function drawLines(canvas,canvasCtx,lines){
    for(let i=0;i<lines.length; i++)
        drawLine(canvas,canvasCtx,lines[i].start, lines[i].end, "blue", 0.5)
}
function drawLine(canvas,canvasCtx,start, end, color, width) {
  canvasCtx.beginPath();
  canvasCtx.moveTo(start.x*canvas.width, start.y*canvas.height);
  canvasCtx.lineTo(end.x*canvas.width, end.y*canvas.height);
  canvasCtx.strokeStyle = color;
  canvasCtx.lineWidth = width;
  canvasCtx.stroke();
}

function toString(angles){
    let str = "[ ";
    str +=angles[0];
    str +=", "
    str +=angles[1];
    str +=", "
    str +=angles[2];
    str +=", "
    str +=angles[3];
    str +=" ]"
    return str;
}

function getMiddlePoint(p1 , p2){
    const x = (p1.x + p2.x) / 2;
    const y = (p1.y + p2.y) / 2;
    return { x, y };
}


