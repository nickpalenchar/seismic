plan.md

# UI Menu spacing

We need to define some new arrangements of all our menu items and control buttnons. We have a few main zones to re-arrange


## Current state 

- **LH menu** (left-hand) - currently just a dropdown with a few configuration and agentic performance things
- **Top nav** - the permanent top horz nav bar, has the project switcher, and some right hand buttons that toggle RH docks
- **RH dock** - a doc that a few different views are used on (like agentic work, chat, inbox)
- **BR buttons** floating canvas buttons
- **BC buttons** bottom center floating buttons, the mic buttton.
- **Low status bar** - shows statuses.


## Desired State
- **LH menu** - turn dockable
- **Top buttons** - a "secondary" horizontal (invisibal) bar under the Top nav, where some buttons will float left and right aligned.

## Where everything will go



### Top Nav
- **Seismic logo + chevron**: stays but have a menu icon first followed by Seismic logo: clicking this toggles docking/visibilty of the **LH Menu** Items (dropdown/floating on medium screens, thats dockable from the floater)
- **search** NEW: full search bar center aligned. Replaces  `/` button. this search still has the correct / shortcut
- Chat icon - pops out the chat as a RH dock
- User avatar - because we are "single user/userless", this is a placeholder, but have it in place

### Top Buttons
- **Project switcher** - taken from the Top nav and floating left side. _Hides_ when the LH menu is docked (because you'll be able to switch projects there)
- And right aligned contains (L to R):
  - Cog icon - single floating icon that will pop up the **Project Level settings**
  - Button group consisting of:
    - Bot icon - the Agents view in the RH Dock
    - Consirge Bell icon "Needs you" - We are bringing back an older **"Needs You"** which will only display cards that the agent is waiting on for a user.

### LH Menu items
- Inbox. Moved from 

## RH Dock

This is a dynamic doc that various views should be able to load into. The RH doc itself should probably consist of different "dock" views that can be loaded into it, and its called with that one (in the future if we wanted to load a new view, it wolud be imported/registered)

####

#### Project Level Settings

#### Agents View


## View information

