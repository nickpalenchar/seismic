
window.SEISMIC_STRINGS = {
  "title": "Seismic",
  "starting": "Seismic is starting …",
  "updating": "Seismic is updating …",
  "status": {
    "unresponsive": "{0} is unresponsive",
    "unreachable": "Nothing answers at {0}. The machine may be off or asleep, or not on this network.",
    "notSeismic": "Something answers at {0}, but it is not Seismic.",
    "notLoaded": "Seismic answers at {0}, but its page did not load.",
    "check": "Check whether Seismic answers at {0}.",
    "retry": "Try again",
    "retrying": "Trying …",
    "help": "Recovery help",
    "others": "Switch workspace",
    "switching": "Switching to {0} …",
    "gone": "{0} is no longer available.",
    "drafts": "Couldn’t save the drafts from this workspace. Reconnect it or use Forward to return to its page, then try again.",
    "switchFailed": "Couldn’t switch to {0}. Try again."
  }
};

window.fillString = (template, ...values) => template.replace(/\{(\d+)\}/g, (_, i) => values[i]);
