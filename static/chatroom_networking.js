
var myID;
var _peer_list = {};
var _cameras_list = {};
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
        // handsDetectCameraLocal(myVideo,constOptions, 480, 480).start()
        _cameras_list[myID]=new Hand(true, "", 480, 480, 1).start(null,"");


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
    // handsDetectCameraRemote(peer_id ,getVideoObj(peer_id), display_name ,constOptions,480, 480).start()
    new Hand(false,peer_id,480,480,1).start(getVideoObj(peer_id), display_name)
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
            // handsDetectCameraRemote(peer_id ,getVideoObj(peer_id), display_name ,constOptions,480, 480).start()
            new Hand(false,peer_id,480,480,1).start(getVideoObj(peer_id),display_name)
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



class Hand {
    constructor(isLocal, id, width, height, maxNumHands) {
        this.isLocal = isLocal
        this.id = id;
        this.width = width;
        this.height = height;
        this.isRightHand = true;
        this.landmarks = null;
        this.classification=null;
        this.video = null;
        this.canvas = null;
        this.controls = null;
        this.canvasCtx = null;
        this.fpsControl = new FPS();
        this.hands = null;
        this.camera = null;
        this.options =  {"selfieMode":true,
                         "maxNumHands":maxNumHands,
                         "minDetectionConfidence":0.5,
                         "minTrackingConfidence":0.5};
        this.userName = "";
        this.handsDetect = new HandDetect();

    }


    // init start
    start(video, userName){
        if(this.isLocal){
            this.handsDetectCameraLocal()
        }
        else {
            this.userName=userName
            this.handsDetectCameraRemote(video)
        }
        return this.camera
    }


    // hands detector init local video
    handsDetectCameraLocal(){
        this.createHands ()
        this.getHTMLMPElements()
        this.hands.onResults(results => this.onResultsHands(results));
        this.createCameraLocal()
        this.createControlPanel()
        this.camera.start()
    }

    // hands detector init remote video
    handsDetectCameraRemote(video) {
        this.createHTMLMPElements()
        addCanvasElement(this, this.id, this.userName)
        this.createHands()
        this.hands.onResults(results => this.onResultsHands(results));
        this.createCameraRemote(video)
        this.createControlPanel()
        this.camera.start()
    }


    // camera create to detect hand
    createCameraLocal() {
        this.camera= new Camera(this.video, {
            onFrame: async () => {
                await this.hands.send({image: this.video});
            },
            width: this.width,
            height: this.height,
        });
    }

     createCameraRemote(video) {
        this.camera= new Camera(video, {
            onFrame: async () => {
                await this.hands.send({image: video});
            },
            width: this.width,
            height: this.height,
        });
    }

    // media pipe hand object init
    createHands() {
        this.hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.1/${file}`;
            }
        });
    }

    // get html ids
    getHTMLIds() {
        const iD = {
            "video": "videoCamera",
            "canvas": "output",
            "controls": "control"
        }
        if (this.id.length === 0)
            return iD;
        iD.video += this.id;
        iD.controls += this.id;
        iD.canvas += this.id;

        return iD;
    }

    // canvas init to show processed frame to local video
    getHTMLMPElements() {
        const iD = this.getHTMLIds();
        this.video = document.getElementById(iD.video);
        this.canvas = document.getElementsByClassName(iD.canvas)[0];
        this.controls = document.getElementsByClassName(iD.controls)[0];
        this.canvasCtx = this.canvas.getContext('2d');
    }

    // canvas init to show processed frame to remote video
    createHTMLMPElements() {
        const iD = this.getHTMLIds();
        this.video= document.createElement("video");
        this.video.id = iD.video
        this.video.autoplay = true
        this.video.style = "display: none"

        this.canvas = document.createElement("canvas");
        this.video.className = iD.canvas

        this.controls = document.createElement("div");
        this.controls.id = iD.controls
        // this.controls.style = "visibility: hidden;"
        this.controls.style = "display: none"

        this.canvasCtx = this.canvas.getContext('2d')
    }

    // process frame to detect hand
    onResultsHands(results) {
        this.canvasCtx.font = '20px Arial';
        this.canvasCtx.fillStyle = 'red';
        this.canvasCtx.textAlign = 'center';
        document.body.classList.add('loaded');
        this.fpsControl.tick();
        this.canvasCtx.save();
        this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.canvasCtx.drawImage(results.image, 0, 0, this.canvas.width,this. canvas.height);
        if (results.multiHandLandmarks && results.multiHandedness) {
            this.classification = results.multiHandedness[0];
            this.isRightHand = this.classification.label === 'Right';
            this.landmarks = results.multiHandLandmarks[0];
            // this.drawDefault();
            this.handsDetect.run([true, true, true],this.isRightHand,this.landmarks,this.canvas,this.canvasCtx)
        }
        this.canvasCtx.restore();
    }

    // draw Default

    drawDefault(){
        drawLandmarks(
              this.canvasCtx, this.landmarks, {
              color: this.isRightHand ? '#00FF00' : '#FF0000',
              fillColor: this.isRightHand ? '#FF0000' : '#00FF00',
              radius: (x) => {
                return lerp(x.from.z, -0.15, .1, 5, 1);
              }
            });
    }


    // control panel create
    createControlPanel() {

        new ControlPanel(this.controls, {
            selfieMode: this.options.selfieMode,
            maxNumHands: this.options.maxNumHands,
            minDetectionConfidence: this.options.minDetectionConfidence,
            minTrackingConfidence: this.options.minTrackingConfidence
        })
            .add([
                new StaticText({title: 'MediaPipe Hands'}),
                this.fpsControl,

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
                this.video.classList.toggle('selfie', options.selfieMode);
                this.hands.setOptions(options);
            });
    }


    // stop hand detector
    stop(){
        this.video.remove()
        this.camera.stop()
    }
}


class HandDetect {
    constructor() {

    }

     run(toShow,isRightHand,landmarks,canvas, canvasCtx){
        this.landmarks = landmarks;
        this.isRightHand= isRightHand;
        this.canvas = canvas;
        this.canvasCtx = canvasCtx;
        this.angles = []
        this.points = [this.landmarks[1], this.landmarks[5], this.landmarks[9], this.landmarks[17]]
        this.calculateAngles();
        if(toShow[0])
            this.showAngles();
        if(toShow[1])
            this.drawCirclesDefault()
        if(toShow[2])
        this.drawLinesDefault()
     }

    calculateAngles() {
        let p1 = 4
        let p2 = 2
        this.landmarks[2] = this.getMiddlePoint(this.landmarks[2], this.landmarks[5])
        let p3 = 6

        let p4 = 8
        let p5 = 5
        this.landmarks[5] = this.getMiddlePoint(this.landmarks[5], this.landmarks[9])
        let p6 = 12

        let p7 = 12
        let p8 = 9
        this.landmarks[9] = this.getMiddlePoint(this.landmarks[9], this.landmarks[13])
        let p9 = 16

        let p10 = 16
        let p11 = 13
        this.landmarks[13] = this.getMiddlePoint(this.landmarks[13], this.landmarks[17])
        let p12 = 20


        const fingers = [
            [p1, p2, p3],
            [p4, p5, p6],
            [p7, p8, p9],
            [p10, p11, p12],
        ];

        let angle;
        this.angles=[]
        for (let i = 0; i < fingers.length; i++) {
            const [p1, p2, p3] = fingers[i].map(idx => this.landmarks[idx]);
            const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
            angle = radians * 180 / Math.PI;
            angle = angle < 0 ? angle + 360 : angle;
            angle = this.reCalculateAngle(angle)
            this.angles.push(Math.round(angle));
        }


    }

    reCalculateAngle(angle) {
        if (this.isRightHand && this.landmarks[0].x < this.landmarks[20].x)
            return angle
        if (this.isRightHand && this.landmarks[0].x > this.landmarks[20].x)
            return 360 - angle
        if (this.landmarks[0].x > this.landmarks[20].x)
            return 360 - angle
        if (this.landmarks[0].x < this.landmarks[20].x)
            return angle
    }

    showAngles() {
        for (let i = 0; i < this.angles.length; i++) {
            this.canvasCtx.fillText(this.angles[i], this.points[i].x * this.canvas.width, this.points[i].y * this.canvas.height);
        }
    }

    drawCirclesDefault() {
        this.drawCircles(3, "red")
    }

    drawCircles(radius, color) {
        for (let i = 0; i < this.points.length; i++) {
            this.drawCircle(this.points[i], radius, color)
        }
    }

    drawCircle( point, radius, color) {
        const startAngle = 0;
        const endAngle = Math.PI * 2;
        const counterClockwise = false;
        this.canvasCtx.beginPath();
        this.canvasCtx.arc(point.x * this.canvas.width, point.y * this.canvas.height, radius, startAngle, endAngle, counterClockwise);
        this.canvasCtx.stroke();
        this.canvasCtx.fillStyle = color;
        this.canvasCtx.fill();
    }

    drawLinesDefault() {


        const lines = [];

        let l1 = {"start": this.landmarks[1], "end": this.landmarks[4]};
        lines.push(l1)
        let l2 = {"start": this.landmarks[1], "end": this.landmarks[5]};
        lines.push(l2)


        let l3 = {"start": this.landmarks[8], "end": this.landmarks[5]};
        lines.push(l3)
        let l4 = {"start": this.landmarks[5], "end": this.landmarks[12]};
        lines.push(l4)


        let l5 = {"start": this.landmarks[12], "end": this.landmarks[9]};
        lines.push(l5)
        let l6 = {"start": this.landmarks[9], "end": this.landmarks[16]};
        lines.push(l6)


        let l7 = {"start": this.landmarks[16], "end": this.landmarks[13]};
        lines.push(l7)
        let l8 = {"start": this.landmarks[13], "end": this.landmarks[20]};
        lines.push(l8)
        this.drawLines(lines)


    }

    drawLines(lines) {
        for (let i = 0; i < lines.length; i++)
            this.drawLine(lines[i].start, lines[i].end, "blue", 0.5)
    }


    drawLine(start, end, color, width) {
        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(start.x * this.canvas.width, start.y * this.canvas.height);
        this.canvasCtx.lineTo(end.x * this.canvas.width, end.y * this.canvas.height);
        this.canvasCtx.strokeStyle = color;
        this.canvasCtx.lineWidth = width;
        this.canvasCtx.stroke();
    }

    toString(angles) {
        let str = "[ ";
        str += angles[0];
        str += ", "
        str += angles[1];
        str += ", "
        str += angles[2];
        str += ", "
        str += angles[3];
        str += " ]"
        return str;
    }

    getMiddlePoint(p1, p2) {
        const x = (p1.x + p2.x) / 2;
        const y = (p1.y + p2.y) / 2;
        return {x, y};
    }
}



