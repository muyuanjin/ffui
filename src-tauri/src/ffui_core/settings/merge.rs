use anyhow::{Result, bail};
use serde_json::Value;

pub(super) fn pointer_child(path: &str, key: &str) -> String {
    format!("{path}/{}", key.replace('~', "~0").replace('/', "~1"))
}

pub(super) fn overlaps(first: &str, second: &str) -> bool {
    first == second
        || first.starts_with(&format!("{second}/"))
        || second.starts_with(&format!("{first}/"))
}

pub(super) fn changes(
    before: Option<&Value>,
    after: Option<&Value>,
    path: &str,
    output: &mut Vec<String>,
) {
    if before == after {
        return;
    }
    if let (Some(Value::Object(before)), Some(Value::Object(after))) = (before, after)
        && !before.contains_key("mode")
        && !after.contains_key("mode")
    {
        let mut keys: Vec<_> = before.keys().chain(after.keys()).collect();
        keys.sort();
        keys.dedup();
        for key in keys {
            changes(
                before.get(key),
                after.get(key),
                &pointer_child(path, key),
                output,
            );
        }
    } else {
        output.push(path.to_string());
    }
}

pub(super) fn update_known(raw: &mut Value, before: Option<&Value>, after: Option<&Value>) {
    if before == after {
        return;
    }
    if let Some(Value::Object(after)) = after {
        if !raw.is_object() {
            *raw = Value::Object(Default::default());
        }
        let target = raw.as_object_mut().expect("object initialized");
        let before = before.and_then(Value::as_object);
        if let Some(before) = before {
            for key in before.keys() {
                if !after.contains_key(key) {
                    target.remove(key);
                }
            }
        }
        for (key, value) in after {
            let previous = before.and_then(|before| before.get(key));
            if previous != Some(value) {
                update_known(
                    target.entry(key.clone()).or_insert(Value::Null),
                    previous,
                    Some(value),
                );
            }
        }
    } else {
        *raw = after.cloned().unwrap_or(Value::Null);
    }
}

pub(super) fn assign(
    raw: &mut Value,
    path: &str,
    before: Option<&Value>,
    after: Option<&Value>,
) -> Result<()> {
    let Some((parent, encoded_key)) = path.rsplit_once('/') else {
        bail!("Invalid settings path: {path}");
    };
    let key = encoded_key.replace("~1", "/").replace("~0", "~");
    ensure_object_path(raw, parent)?;
    let target = raw
        .pointer_mut(parent)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| anyhow::anyhow!("Settings path is not an object: {parent}"))?;
    if after.is_none() {
        target.remove(&key);
    } else {
        update_known(target.entry(key).or_insert(Value::Null), before, after);
    }
    Ok(())
}

pub(super) fn materialize_parents(raw: &mut Value, known: &Value, path: &str) -> Result<()> {
    let Some((parent, _)) = path.rsplit_once('/') else {
        bail!("Invalid settings path: {path}");
    };
    if parent.is_empty() {
        return Ok(());
    }
    materialize_parents(raw, known, parent)?;
    if raw.pointer(parent).is_none() {
        assign(raw, parent, None, known.pointer(parent))?;
    }
    Ok(())
}

pub(super) fn has_unprojected_mode_fields(raw: &Value, known: &Value) -> bool {
    match (raw, known) {
        (Value::Object(raw), Value::Object(known)) => raw.iter().any(|(key, value)| {
            if raw.contains_key("mode") && !known.contains_key(key) {
                return true;
            }
            known
                .get(key)
                .is_some_and(|known| has_unprojected_mode_fields(value, known))
        }),
        _ => false,
    }
}

fn ensure_object_path(raw: &mut Value, path: &str) -> Result<()> {
    if path.is_empty() {
        if !raw.is_object() {
            *raw = Value::Object(Default::default());
        }
        return Ok(());
    }
    let (parent, encoded_key) = path.rsplit_once('/').expect("JSON pointer");
    ensure_object_path(raw, parent)?;
    let key = encoded_key.replace("~1", "/").replace("~0", "~");
    let target = raw
        .pointer_mut(parent)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| anyhow::anyhow!("Settings path is not an object: {parent}"))?;
    let entry = target
        .entry(key)
        .or_insert_with(|| Value::Object(Default::default()));
    if !entry.is_object() {
        bail!("Settings path is not an object: {path}");
    }
    Ok(())
}
