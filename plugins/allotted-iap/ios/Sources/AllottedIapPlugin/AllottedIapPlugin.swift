import Capacitor
import Foundation
import StoreKit

@objc(AllottedIapPlugin)
public class AllottedIapPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AllottedIapPlugin"
    public let jsName = "AllottedIAP"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise)
    ]

    private let productIds: Set<String> = [
        "allotted.premium.monthly",
        "allotted.premium.yearly"
    ]

    private var updatesTask: Task<Void, Never>?

    public override func load() {
        if #available(iOS 15.0, *) {
            updatesTask = Task.detached { [productIds] in
                for await update in Transaction.updates {
                    guard case .verified(let transaction) = update,
                          productIds.contains(transaction.productID) else { continue }
                    await transaction.finish()
                }
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("Allotted Premium purchases require iOS 15 or later.")
            return
        }
        guard let productId = call.getString("productId"), productIds.contains(productId) else {
            call.reject("Unknown Premium product.")
            return
        }

        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    call.reject("Premium product is not available yet.")
                    return
                }

                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    let transaction = try checkVerified(verification)
                    await transaction.finish()
                    call.resolve(await entitlementStatus())
                case .userCancelled:
                    call.resolve(["active": false, "cancelled": true])
                case .pending:
                    call.resolve(["active": false, "pending": true])
                @unknown default:
                    call.resolve(["active": false])
                }
            } catch {
                call.reject("Purchase failed. Please try again.", nil, error)
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.reject("Allotted Premium purchases require iOS 15 or later.")
            return
        }

        Task {
            do {
                try await AppStore.sync()
                call.resolve(await entitlementStatus())
            } catch {
                call.reject("Restore failed. Please try again.", nil, error)
            }
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["active": false])
            return
        }

        Task {
            call.resolve(await entitlementStatus())
        }
    }

    @objc func getProducts(_ call: CAPPluginCall) {
        guard #available(iOS 15.0, *) else {
            call.resolve(["products": []])
            return
        }

        Task {
            do {
                let products = try await Product.products(for: Array(productIds))
                call.resolve([
                    "products": products.map { product in
                        [
                            "id": product.id,
                            "displayName": product.displayName,
                            "description": product.description,
                            "displayPrice": product.displayPrice,
                            "plan": plan(for: product.id) ?? ""
                        ]
                    }
                ])
            } catch {
                call.reject("Could not load Premium products.", nil, error)
            }
        }
    }

    @available(iOS 15.0, *)
    private func entitlementStatus() async -> [String: Any] {
        var best: Transaction?

        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            guard productIds.contains(transaction.productID) else { continue }
            guard transaction.revocationDate == nil else { continue }
            if let expirationDate = transaction.expirationDate, expirationDate <= Date() { continue }

            if best == nil {
                best = transaction
            } else if let currentExpiration = transaction.expirationDate,
                      let bestExpiration = best?.expirationDate,
                      currentExpiration > bestExpiration {
                best = transaction
            }
        }

        guard let transaction = best else {
            return [
                "active": false,
                "productId": NSNull(),
                "plan": NSNull()
            ]
        }

        var status: [String: Any] = [
            "active": true,
            "productId": transaction.productID,
            "plan": plan(for: transaction.productID) ?? ""
        ]
        if let expirationDate = transaction.expirationDate {
            status["expiresAt"] = Int64(expirationDate.timeIntervalSince1970 * 1000)
        }
        return status
    }

    @available(iOS 15.0, *)
    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .verified(let signedType):
            return signedType
        case .unverified(_, let error):
            throw error
        }
    }

    private func plan(for productId: String) -> String? {
        switch productId {
        case "allotted.premium.monthly":
            return "monthly"
        case "allotted.premium.yearly":
            return "yearly"
        default:
            return nil
        }
    }
}
