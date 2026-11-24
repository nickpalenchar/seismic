// Written by scripts/desktop-strings.ts from desktopPages in src/ui/strings.ts; change it there.
window.SEISMIC_STRINGS = {
  "starting": "Seismic is starting …",
  "updating": "Seismic is updating …",
  "status": {
    "title": "Seismic",
    "doesNotAnswer": "{0} does not answer",
    "unreachable": "Nothing answers at {0}. The machine may be off or asleep, or not on this network.",
    "notSeismic": "Something answers at {0}, but it is not Seismic.",
    "notLoaded": "Seismic answers at {0}, but its page did not load.",
    "check": "Check whether Seismic answers at {0}.",
    "retry": "Try again",
    "retrying": "Trying …",
    "others": "Switch workspace",
    "switching": "Switching to {0} …",
    "gone": "{0} is no longer available.",
    "drafts": "Couldn’t save the drafts from this workspace. Reconnect it or use Forward to return to its page, then try again.",
    "switchFailed": "Couldn’t switch to {0}. Try again."
  }
};
/** A template's {0}, {1} … filled in with the values, in that order. */
window.fillString = (template, ...values) => template.replace(/\{(\d+)\}/g, (_, i) => values[i]);
