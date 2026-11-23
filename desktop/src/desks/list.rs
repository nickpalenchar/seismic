// The workspaces list (a workspace is a *desk* in code): this machine's Seismic and the remote ones
// the owner paired, one per origin, in the home's `app-desks.json`. The first attempt at workspaces
// (backup/desktop-architecture) wrote the same file, `{ "list": [{ "id", "name", "url" }] }` with
// an `active` id and a `microphone` flag beside: both are read past, as the windows and the
// microphone follow other rules now.

use std::{fs, io::Write, path::Path};

use serde_json::{json, Value};
use tauri::Url;

/// This machine's desk, always on the list.
pub const LOCAL: &str = "local";
const FILE: &str = "app-desks.json";
const UNREADABLE: &str = "app-desks.unreadable.json";

#[derive(Clone, Debug, PartialEq)]
pub struct Desk {
  pub id: String,
  /// The owner's name for it; blank: the machine's name (this machine's) or the host (a remote one's).
  pub name: String,
  /// The origin of a remote one (`https://studio.example.ts.net`); none for this machine's.
  pub origin: Option<String>,
}

impl Desk {
  pub fn local(&self) -> bool {
    self.origin.is_none()
  }

  /// The name the pages and the menu show.
  pub fn shown_name(&self, machine: &str) -> String {
    let name = self.name.trim();
    if !name.is_empty() {
      return name.to_string();
    }
    match &self.origin {
      None => machine.to_string(),
      Some(o) => Url::parse(o).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_else(|| o.clone()),
    }
  }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Desks {
  pub list: Vec<Desk>,
}

impl Default for Desks {
  fn default() -> Self {
    Desks {
      list: vec![Desk {
        id: LOCAL.into(),
        name: String::new(),
        origin: None,
      }],
    }
  }
}

/// A domain with any of these names no origin: the URL parser lets them through, and a capability's
/// URLPattern would read them as its own syntax (a wildcard, a group, an escape).
const PATTERN_SYNTAX: &[char] = &['*', '?', '+', '{', '}', '(', ')', '\\', ':', '[', ']'];

/// The origin an address names: `https://studio.example.ts.net`, `http://100.64.0.2:4417`. Without a
/// scheme it is HTTPS, as `tailscale serve` gives it; a path, query or fragment is dropped. Only
/// HTTP and HTTPS. IPv6 literals are escaped separately when building the capability pattern.
pub fn origin(address: &str) -> Option<String> {
  let a = address.trim();
  if a.is_empty() {
    return None;
  }
  let url = if a.contains("://") {
    Url::parse(a).ok()?
  } else {
    Url::parse(&format!("https://{a}")).ok()?
  };
  let host = url.host_str()?;
  let ipv6 = host.starts_with('[') && host.ends_with(']');
  if !matches!(url.scheme(), "http" | "https") || host.is_empty() || (!ipv6 && host.contains(PATTERN_SYNTAX)) || !url.username().is_empty() || url.password().is_some() {
    return None;
  }
  Some(url.origin().ascii_serialization())
}

impl Desks {
  /// The list in `home`, with this machine's first; this machine's alone without one. A file that
  /// cannot be read is put aside (`app-desks.unreadable.json`), not overwritten by the next save.
  pub fn load(home: &Path) -> Desks {
    let path = home.join(FILE);
    let text = fs::read(&path).ok();
    let read = text.as_deref().and_then(|t| serde_json::from_slice::<Value>(t).ok());
    if text.is_some() && read.is_none() {
      eprintln!("seismic: {} cannot be read, put aside", path.display());
      let _ = fs::rename(&path, home.join(UNREADABLE));
    }
    Self::from_json(read.as_ref())
  }

  fn from_json(read: Option<&Value>) -> Desks {
    let mut all = Desks::default();
    let entries = read.and_then(|v| v["list"].as_array()).map(Vec::as_slice).unwrap_or_default();
    for e in entries {
      let (Some(id), name) = (e["id"].as_str(), e["name"].as_str().unwrap_or_default()) else {
        continue;
      };
      if id == LOCAL {
        all.list[0].name = name.to_string();
        continue;
      }
      // one per origin: a second at the same origin goes
      let Some(o) = e["url"].as_str().and_then(origin) else { continue };
      if id.is_empty() || all.at_origin(&o).is_some() {
        continue;
      }
      // Old builds could save one ID for two origins. Keep both and leave every other saved ID alone.
      let id = if all.get(id).is_some() {
        (2..)
          .map(|n| format!("{id}-{n}"))
          .find(|candidate| all.get(candidate).is_none() && !entries.iter().any(|entry| entry["id"].as_str() == Some(candidate.as_str())))
          .unwrap()
      } else {
        id.to_string()
      };
      all.list.push(Desk {
        id,
        name: name.to_string(),
        origin: Some(o),
      });
    }
    all
  }

  /// Saves the list in `home`: the whole of it, or the file stays as it was.
  pub fn save(&self, home: &Path) -> Result<(), String> {
    let list: Vec<Value> = self.list.iter().map(|d| json!({ "id": d.id, "name": d.name, "url": d.origin })).collect();
    let text = format!("{:#}\n", json!({ "list": list }));
    let (path, part) = (home.join(FILE), home.join(format!("{FILE}.part")));
    let write = || -> std::io::Result<()> {
      fs::create_dir_all(home)?;
      let mut f = fs::File::create(&part)?;
      f.write_all(text.as_bytes())?;
      f.sync_all()?;
      fs::rename(&part, &path)
    };
    write().map_err(|e| {
      let _ = fs::remove_file(&part);
      format!("{}: {e}", path.display())
    })
  }

  pub fn get(&self, id: &str) -> Option<&Desk> {
    self.list.iter().find(|d| d.id == id)
  }

  /// The remote desk at `origin` (as `origin` makes it).
  pub fn at_origin(&self, origin: &str) -> Option<&Desk> {
    self.list.iter().find(|d| d.origin.as_deref() == Some(origin))
  }

  /// A new remote desk at `origin`; refused where one is there already (`known`).
  pub fn add(&mut self, name: &str, origin: &str) -> Result<Desk, &'static str> {
    if self.at_origin(origin).is_some() {
      return Err("known");
    }
    let desk = Desk {
      id: std::iter::repeat_with(|| format!("w{}", uuid::Uuid::new_v4())).find(|id| self.get(id).is_none()).unwrap(),
      name: name.trim().to_string(),
      origin: Some(origin.to_string()),
    };
    self.list.push(desk.clone());
    Ok(desk)
  }

  /// Renames desk `id`; a blank name gives it its default back.
  pub fn rename(&mut self, id: &str, name: &str) -> Result<(), &'static str> {
    let desk = self.list.iter_mut().find(|d| d.id == id).ok_or("unknown")?;
    desk.name = name.trim().to_string();
    Ok(())
  }

  /// Moves the remote desk `id` to `origin`; refused where another desk is there (`known`).
  pub fn move_to(&mut self, id: &str, origin: &str) -> Result<(), &'static str> {
    if self.at_origin(origin).is_some_and(|d| d.id != id) {
      return Err("known");
    }
    let desk = self.list.iter_mut().find(|d| d.id == id).ok_or("unknown")?;
    if desk.local() {
      return Err("local");
    }
    desk.origin = Some(origin.to_string());
    Ok(())
  }

  /// Takes the remote desk `id` out. This machine's stays.
  pub fn remove(&mut self, id: &str) -> Result<Desk, &'static str> {
    let at = self.list.iter().position(|d| d.id == id).ok_or("unknown")?;
    if self.list[at].local() {
      return Err("local");
    }
    Ok(self.list.remove(at))
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn an_address_names_its_origin() {
    assert_eq!(origin("studio.example.ts.net").as_deref(), Some("https://studio.example.ts.net"));
    assert_eq!(origin(" http://100.64.0.2:4417/pair?code=1 ").as_deref(), Some("http://100.64.0.2:4417"));
    assert_eq!(origin("https://Studio.Example:443/").as_deref(), Some("https://studio.example"));
    assert_eq!(origin("http://[FD7A:0::2]:4417/p").as_deref(), Some("http://[fd7a::2]:4417"));
    assert_eq!(origin("http://studio:80").as_deref(), Some("http://studio"));
  }

  #[test]
  fn an_address_a_pattern_would_misread_names_none() {
    for a in [
      "",
      "file:///etc",
      "ftp://studio",
      "https://user@studio",
      "https://a*b",
      "javascript:alert(1)",
    ] {
      assert_eq!(origin(a), None, "{a}");
    }
  }

  #[test]
  fn the_list_keeps_this_machine_first_and_one_desk_per_origin() {
    let read = json!({ "active": "b", "list": [
      { "id": "a", "name": "Studio", "url": "https://studio", "microphone": true },
      { "id": "local", "name": "Laptop" },
      { "id": "b", "name": "Again", "url": "https://studio/" },
      { "id": "c", "name": "", "url": "not an address" },
      { "id": "d", "name": "", "url": "http://10.0.0.2:4417" },
      { "id": "v6", "name": "", "url": "https://[fd7a::2]:4417" },
    ]});
    let all = Desks::from_json(Some(&read));
    let ids: Vec<&str> = all.list.iter().map(|d| d.id.as_str()).collect();
    assert_eq!(ids, ["local", "a", "d", "v6"]);
    assert_eq!(all.list[0].name, "Laptop");
  }

  #[test]
  fn the_list_survives_a_save_and_a_load() {
    let home = std::env::temp_dir().join(format!("seismic-desks-{}", uuid::Uuid::new_v4()));
    let mut all = Desks::default();
    all.add(" Studio ", "https://studio").unwrap();
    all.add("", "https://[fd7a::2]:4417").unwrap();
    all.rename(LOCAL, "Laptop").unwrap();
    all.save(&home).unwrap();
    assert_eq!(Desks::load(&home), all);
    fs::write(home.join(FILE), "{ broken").unwrap();
    assert_eq!(Desks::load(&home), Desks::default());
    assert!(home.join(UNREADABLE).exists());
    let _ = fs::remove_dir_all(&home);
  }

  #[test]
  fn additions_finishing_together_keep_distinct_ids_on_disk() {
    use std::sync::{Barrier, Mutex};
    let home = std::env::temp_dir().join(format!("seismic-desks-{}", uuid::Uuid::new_v4()));
    let all = Mutex::new(Desks::default());
    let finish = Barrier::new(2);
    let ids = std::thread::scope(|scope| {
      let add = |origin| {
        finish.wait();
        let mut desks = all.lock().unwrap();
        let desk = desks.add("", origin).unwrap();
        desks.save(&home).unwrap();
        desk.id
      };
      let studio = scope.spawn(move || add("https://studio"));
      let lab = scope.spawn(move || add("https://lab"));
      [studio.join().unwrap(), lab.join().unwrap()]
    });
    assert_ne!(ids[0], ids[1]);
    let mut saved = Desks::load(&home);
    assert_eq!(saved.remove(&ids[0]).unwrap().origin.as_deref(), Some("https://studio"));
    assert_eq!(saved.get(&ids[1]).unwrap().origin.as_deref(), Some("https://lab"));
    fs::remove_dir_all(home).unwrap();
  }

  #[test]
  fn a_saved_id_collision_keeps_both_origins_and_reserves_later_ids() {
    let file = json!({ "list": [
      { "id": "w1", "url": "https://studio" },
      { "id": "w1", "url": "https://lab" },
      { "id": "w1-2", "url": "https://office" },
    ] });
    let mut all = Desks::from_json(Some(&file));
    assert_eq!(all.at_origin("https://studio").unwrap().id, "w1");
    assert_eq!(all.at_origin("https://lab").unwrap().id, "w1-3");
    assert_eq!(all.at_origin("https://office").unwrap().id, "w1-2");
    assert_eq!(all.remove("w1-3").unwrap().origin.as_deref(), Some("https://lab"));
    assert!(all.get("w1").is_some());
  }

  #[test]
  fn changes_keep_one_desk_per_origin_and_this_machines() {
    let mut all = Desks::default();
    let a = all.add("", "https://studio").unwrap().id;
    let b = all.add("", "https://lab").unwrap().id;
    assert_eq!(all.add("", "https://studio"), Err("known"));
    assert_eq!(all.move_to(&b, "https://studio"), Err("known"));
    all.move_to(&b, "https://lab2").unwrap();
    assert_eq!(all.remove(LOCAL), Err("local"));
    assert_eq!(all.move_to(LOCAL, "https://x"), Err("local"));
    assert_eq!(all.remove(&a).map(|d| d.id), Ok(a));
    assert_eq!(all.get(&b).unwrap().shown_name("Mac"), "lab2");
    assert_eq!(all.get(LOCAL).unwrap().shown_name("Mac"), "Mac");
  }
}
