var myID;
var _peer_list = {};
// socketio
var protocol = window.location.protocol;
var socket = io(protocol + '//' + document.domain + ':' + location.port, {autoConnect: false});

var camera_allowed=false;
var mediaConstraints = {
    audio: true, // We want an audio track
    video: {
        height: 360
    } // ...and we want a video track
};


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
        handsDetectCamera("",{"selfieMode":false,
                                        "maxNumHands":2,
                                        "minDetectionConfidence":0.5,
                                        "minTrackingConfidence":0.5},
                                    480,
                                    480).start()

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
});


socket.on("user-disconnect", (data)=>{
    console.log("user-disconnect ", data);
    let peer_id = data["sid"];
    closeConnection(peer_id);
    removeVideoElement(peer_id);
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

// hands detector init
function handsDetectCamera(id, options, width, height){
    const hands = createHands()
    const htmlElement= createHTMLMPElement("")
    hands.onResults(results => onResultsHands(results, htmlElement));
    const camera = createCamera(htmlElement.video,hands,width,height)
    createControlPanel(hands,htmlElement,options)
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

    return id;
}

// canvas init to show processed frame
function createHTMLMPElement(id){
    const iD=getHTMLIds(id);
    let video = document.getElementById(iD.video);
    let canvas = document.getElementsByClassName(iD.canvas)[0];
    let controls = document.getElementsByClassName(iD.controls)[0];
    let canvasCtx = canvas.getContext('2d');
    let fpsControl = new FPS();
    return {"video":video,"canvas":canvas,"controls":controls,"canvasCtx":canvasCtx,"fpsControl":fpsControl};
}

// process frame to detect hand
function onResultsHands(results, htmlElement) {
   const canvas = htmlElement.canvas
   const canvasCtx = htmlElement.canvasCtx
   const fpsControl = htmlElement.fpsControl

   document.body.classList.add('loaded');
  fpsControl.tick();
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  canvasCtx.drawImage(
      results.image, 0, 0, canvas.width, canvas.height);
  if (results.multiHandLandmarks && results.multiHandedness) {
    for (let index = 0; index < results.multiHandLandmarks.length; index++) {
        const classification = results.multiHandedness[index];
        const isRightHand = classification.label === 'Right';
        const landmarks = results.multiHandLandmarks[index];
        drawConnectors(
            canvasCtx, landmarks, HAND_CONNECTIONS,
            {color: isRightHand ? '#00FF00' : '#FF0000'}),
            drawLandmarks(canvasCtx, landmarks, {
              color: isRightHand ? '#00FF00' : '#FF0000',
              fillColor: isRightHand ? '#FF0000' : '#00FF00',
              radius: (x) => {
                return lerp(x.from.z, -0.15, .1, 5, 1);
              }
            });
      }
  }
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


