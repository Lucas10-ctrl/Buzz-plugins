//! Private repository-worker helper for the Editor Lab's Higgsfield credential.
//! Only status/set are exposed by the editor repository; read stays worker-private.
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{Read, Write};
use zeroize::Zeroizing;

#[cfg(not(feature = "packaged-plugin"))]
const SERVICE: &str = "xyz.block.buzz.editorlab.higgsfield";
#[cfg(feature = "packaged-plugin")]
const SERVICE: &str = "xyz.block.buzz.editors.higgsfield";
const ACCOUNT: &str = "api";
const LIMIT: usize = 32 * 1024;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase", deny_unknown_fields)]
enum Request {
    Status {},
    Read {},
    Set { value: String },
}
trait Storage {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, &'static str>;
    fn set(&self, value: &[u8]) -> Result<(), &'static str>;
}
struct Native;
fn storage_error(error: buzz_credential_store::Error) -> &'static str {
    use buzz_credential_store::Error;
    match error {
        Error::Denied => "Canvas credential access was denied",
        Error::Busy => "Canvas credential storage is busy; try again",
        Error::Corrupt => "The saved Canvas credential is invalid",
        _ => "Canvas secure credential storage is unavailable",
    }
}
impl Storage for Native {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, &'static str> {
        match buzz_credential_store::read(SERVICE, ACCOUNT) {
            Ok(value) => Ok(Some(value)),
            Err(buzz_credential_store::Error::Absent) => Ok(None),
            Err(error) => Err(storage_error(error)),
        }
    }
    fn set(&self, value: &[u8]) -> Result<(), &'static str> {
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        return buzz_credential_store::replace(SERVICE, ACCOUNT, value).map_err(storage_error);
        #[cfg(target_os = "macos")]
        {
            let text = std::str::from_utf8(value).map_err(|_| "Invalid Canvas credential")?;
            keyring::Entry::new(SERVICE, ACCOUNT)
                .and_then(|entry| entry.set_password(text))
                .map_err(|_| "Canvas secure credential storage is unavailable")
        }
    }
}
fn valid(value: &str) -> bool {
    value.len() <= 4096
        && value.split_once(':').is_some_and(|(id, secret)| {
            !id.is_empty()
                && !secret.is_empty()
                && !secret.contains(':')
                && !value.chars().any(char::is_whitespace)
                && !value.chars().any(char::is_control)
        })
}
fn answer(source: &[u8], storage: &impl Storage) -> Result<Value, &'static str> {
    if source.len() > LIMIT {
        return Err("Canvas credential request is too large");
    }
    let request: Request =
        serde_json::from_slice(source).map_err(|_| "Invalid Canvas credential request")?;
    match request {
        Request::Status {} => {
            Ok(json!({ "configured": storage.read()?.is_some(), "writable": true }))
        }
        Request::Read {} => match storage.read()? {
            None => Ok(Value::Null),
            Some(bytes) => {
                let value = std::str::from_utf8(&bytes)
                    .map_err(|_| "The saved Canvas credential is invalid")?;
                if !valid(value) {
                    return Err("The saved Canvas credential is invalid");
                }
                Ok(Value::String(value.to_owned()))
            }
        },
        Request::Set { value } => {
            let value = Zeroizing::new(value);
            if !valid(&value) {
                return Err("Enter a Higgsfield KEY_ID:KEY_SECRET credential");
            }
            storage.set(value.as_bytes())?;
            Ok(Value::Null)
        }
    }
}
fn main() {
    let mut input = Zeroizing::new(Vec::new());
    let result = std::io::stdin()
        .take((LIMIT + 1) as u64)
        .read_to_end(&mut input)
        .map_err(|_| "Could not read Canvas credential request")
        .and_then(|_| answer(&input, &Native));
    let response = match result {
        Ok(value) => json!({ "ok": true, "value": value }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    // A failed output never prints the response or the credential on stderr.
    if serde_json::to_writer(std::io::stdout().lock(), &response).is_err()
        || std::io::stdout().flush().is_err()
    {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    struct Fake {
        value: RefCell<Option<Vec<u8>>>,
        denied: bool,
    }
    impl Storage for Fake {
        fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, &'static str> {
            if self.denied {
                return Err("Canvas credential access was denied");
            }
            Ok(self.value.borrow().clone().map(Zeroizing::new))
        }
        fn set(&self, value: &[u8]) -> Result<(), &'static str> {
            if self.denied {
                return Err("Canvas credential access was denied");
            }
            *self.value.borrow_mut() = Some(value.to_vec());
            Ok(())
        }
    }
    fn store() -> Fake {
        Fake {
            value: RefCell::new(None),
            denied: false,
        }
    }
    #[test]
    fn status_and_set_never_return_the_secret() {
        let storage = store();
        assert_eq!(
            answer(br#"{"operation":"status"}"#, &storage).unwrap(),
            json!({"configured":false,"writable":true})
        );
        assert_eq!(
            answer(br#"{"operation":"set","value":"test:key"}"#, &storage).unwrap(),
            Value::Null
        );
        let status = answer(br#"{"operation":"status"}"#, &storage).unwrap();
        assert_eq!(status, json!({"configured":true,"writable":true}));
        assert!(!status.to_string().contains("test:key"));
        assert_eq!(
            answer(br#"{"operation":"read"}"#, &storage).unwrap(),
            "test:key"
        );
    }
    #[test]
    fn denied_access_is_not_missing_and_failed_updates_keep_the_old_key() {
        let storage = Fake {
            value: RefCell::new(Some(b"old:key".to_vec())),
            denied: true,
        };
        assert!(answer(br#"{"operation":"status"}"#, &storage).is_err());
        assert!(answer(br#"{"operation":"set","value":"new:key"}"#, &storage).is_err());
        assert_eq!(
            storage.value.borrow().as_deref(),
            Some(b"old:key".as_slice())
        );
    }
    #[test]
    fn invalid_requests_cannot_select_another_service_or_echo_their_content() {
        let storage = store();
        for request in [
            br#"{"operation":"read","service":"human"}"#.as_slice(),
            br#"{"operation":"set","value":"private-input"}"#,
            br#"private-input"#,
        ] {
            let error = answer(request, &storage).unwrap_err();
            assert!(!error.contains("private-input"));
        }
        assert!(answer(&vec![b' '; LIMIT + 1], &storage).is_err());
        assert!(storage.value.borrow().is_none());
    }
}
