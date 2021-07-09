var userMediaStream;
var playlist;
var constraints = { 
  audio: true, 
  noiseSuppresion: false, 
  echoCancellation: false, 
  autoGainControl: true,
  latency: 0,
  sampleSize: 16
};
var loadingPromise;

navigator.getUserMedia = (navigator.getUserMedia ||
  navigator.webkitGetUserMedia ||
  navigator.mozGetUserMedia ||
  navigator.msGetUserMedia);

function gotStream(stream) {
  userMediaStream = stream;
  playlist.initRecorder(userMediaStream);
  startRecording();
}

function initializeRecording() {
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia(constraints)
    .then(gotStream)
    .catch(console.error);
  } else if (navigator.getUserMedia && 'MediaRecorder' in window) {
    navigator.getUserMedia(
      constraints,
      gotStream,
      console.error
    );
  }
}

function startRecording() {
  if(isRecording) return;
  isRecording = true;
  $(".btn-record").addClass("active");
  $(".btn-play").addClass("disabled");
  $(".btn-pause").addClass("disabled");
  $(".btn-rewind").addClass("disabled");
  ee.emit("record");
}

/*
 * This script is provided to give an example how the playlist can be controlled using the event emitter.
 * This enables projects to create/control the useability of the project.
*/
var ee = playlist.getEventEmitter();
ee.emit("automaticscroll", true);
var $container = $("body");
var $timeFormat = $container.find('.time-format');
var $audioStart = $container.find('.audio-start');
var $audioEnd = $container.find('.audio-end');
var $time = $container.find('.audio-pos');
var $select = $container.find('.select-songs')

var format = "hh:mm:ss.uuu";
var startTime = 0;
var endTime = 0;
var audioPos = 0;
var downloadUrl = undefined;
var isLooping = false;
var isRecording = false;
var playoutPromises;
var loadingFinished;
var loadingTotal;
var uploadTrack;

function toggleActive(node) {
  var active = node.parentNode.querySelectorAll('.active');
  var i = 0, len = active.length;

  for (; i < len; i++) {
    active[i].classList.remove('active');
  }

  node.classList.toggle('active');
}

function cueFormatters(format) {

  function clockFormat(seconds, decimals) {
    var hours,
        minutes,
        secs,
        result;

    hours = parseInt(seconds / 3600, 10) % 24;
    minutes = parseInt(seconds / 60, 10) % 60;
    secs = seconds % 60;
    secs = secs.toFixed(decimals);

    result = (hours < 10 ? "0" + hours : hours) + ":" + (minutes < 10 ? "0" + minutes : minutes) + ":" + (secs < 10 ? "0" + secs : secs);

    return result;
  }

  var formats = {
    "seconds": function (seconds) {
        return seconds.toFixed(0);
    },
    "thousandths": function (seconds) {
        return seconds.toFixed(3);
    },
    "hh:mm:ss": function (seconds) {
        return clockFormat(seconds, 0);   
    },
    "hh:mm:ss.u": function (seconds) {
        return clockFormat(seconds, 1);   
    },
    "hh:mm:ss.uu": function (seconds) {
        return clockFormat(seconds, 2);   
    },
    "hh:mm:ss.uuu": function (seconds) {
        return clockFormat(seconds, 3);   
    }
  };

  return formats[format];
}

function updateSelect(start, end) {
  if (start < end) {
    $('.btn-trim-audio').removeClass('disabled');
    $('.btn-loop').removeClass('disabled');
  }
  else {
    $('.btn-trim-audio').addClass('disabled');
    $('.btn-loop').addClass('disabled');
  }

  $audioStart.val(cueFormatters(format)(start));
  $audioEnd.val(cueFormatters(format)(end));

  startTime = start;
  endTime = end;
}

function updateTime(time) {
  $time.html(cueFormatters(format)(time));

  audioPos = time;
}

updateSelect(startTime, endTime);
updateTime(audioPos);

/*
* Code below sets up events to send messages to the playlist.
*/

$container.on("click", ".btn-play", function() {
  if(!isRecording)
    ee.emit("play");
});

$container.on("click", ".btn-pause", function() {
  if(!isRecording) {
    isLooping = false;
    ee.emit("pause");
  }
});

$container.on("click", ".btn-stop", function() {
  isLooping = false;
  ee.emit("stop");
});

$container.on("click", ".btn-rewind", function() {
  if(!isRecording) {
    isLooping = false;
    ee.emit("rewind");
  }
});

$container.on("click", ".btn-fast-forward", function() {
  isLooping = false;
  ee.emit("fastforward");
});

$container.on("click", ".btn-clear", function() {
  isLooping = false;
  ee.emit("clear");
});

$container.on("click", ".btn-record", function() {
  if(userMediaStream == null || !userMediaStream.active)
    initializeRecording();
  else {
    startRecording();
  }
});

function loadnew(song) {
  ee.emit("clear");
  ee.emit("stop");
  ee.emit("rewind");
  $("#lyrics-container").hide();
  $("#lyrics").empty();
  if (song != -1) {
    var list = resources.songs[song].audio;
    loadingPromise = playlist.load(list).then(function(){
      $("#lyrics-container").height($("#playlist").height());
      $("#lyrics-container").fadeIn();
      $("#loading-progress").animate({ opacity: 0 }, function(){
        $("#loading-progress > .progress-bar").width("0%");
      });
    });
    loadingTotal = list.length * 3; //3 states to run through
    loadingFinished = 0;
    $("#loading-progress").animate({ opacity: 1 });
    $("#loading-progress > .progress-bar").text("0%");
    $("#loading-progress > .progress-bar").width("0%");

    if(resources.songs[song].text != null) {
        $.get(resources.songs[song].text, function( data ) {
          var marker = "";
          data = data.replace(/\[(\d{1,2})\:(\d{2})\]\s*([^\\\n]*)/g, function(match, p1, p2, p3){
            var t = parseInt(p1) * 60 + parseInt(p2);
            return `<span data-time='${t}' class='lyricsmarker'>${p3} </span>
                    <span class='lyricsmarker_time'>${p1}:${p2}</span>`;
          });
          $("#lyrics" ).html( md.render(data) );
        });
      }
    return;
  }
  loadingPromise = new Promise((resolve) => { resolve(); });
}

$(document).on("click", ".lyricsmarker", function(e) {
  ee.emit("play", parseFloat($(this).data("time")));
});

$select.on("change", function() {
  var song = parseInt($select.val());
  if(loadingPromise != null) {
    loadingPromise.then(() => loadnew(song))
  } else {
    loadnew(song);
  }
});


/*
* Code below receives updates from the playlist.
*/
ee.on("select", updateSelect);

ee.on("timeupdate", updateTime);

ee.on("audiorequeststatechange", function(state, src) {
  var percent = (++loadingFinished / loadingTotal * 100).toFixed() + "%";
  $("#loading-progress > .progress-bar").text(percent);
  $("#loading-progress > .progress-bar").width(percent);
});

ee.on("stop", function(){
  isRecording = false;
  $(".btn-record").removeClass("active");
  $(".btn-play").removeClass("disabled");
  $(".btn-rewind").removeClass("disabled");
  $(".btn-pause").removeClass("disabled");
});

/*ee.on("loadprogress", function(percent, src) {
  $(".loading-progress").text(percent.toFixed(0) + "%");
});*/

ee.on("upload", function(track) {
  $("#uploadModal").modal('show');
  uploadTrack = track;
})


ee.on("audiorequeststatechange", function(state, src) {
  var name = src;

  if (src instanceof File) {
    name = src.name;
  }

  console.log("Track " + name + " is in state " + state);
});

ee.on("audiosourcesloaded", function() {
  console.log("Tracks have all finished decoding.");
});

ee.on("audiosourcesrendered", function() {
  console.log("Tracks have been rendered");
});
